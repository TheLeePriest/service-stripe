import type { Construct } from "constructs";
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import type { StripeStackProps } from "../types/stacks.types";
import {
  AttributeType,
  BillingMode,
  StreamViewType,
  Table,
} from "aws-cdk-lib/aws-dynamodb";
import { TSLambdaFunction } from "the-ldk";
import path from "node:path";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { EventBus, Rule } from "aws-cdk-lib/aws-events";
import {
  Role,
  ServicePrincipal,
  PolicyStatement,
  Effect,
} from "aws-cdk-lib/aws-iam";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { SqsQueue } from "aws-cdk-lib/aws-events-targets";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Alarm, ComparisonOperator, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Topic } from "aws-cdk-lib/aws-sns";

export class ServiceStripeStack extends Stack {
  constructor(scope: Construct, id: string, props: StripeStackProps) {
    super(scope, id, props);

    const { stage, targetEventBusName, serviceName } = props;
    const tsConfigPath = path.join(__dirname, "../../tsconfig.json");

    const STRIPE_SECRET_KEY = StringParameter.fromStringParameterAttributes(
      this,
      `${serviceName}-secret-key-${stage}`,
      {
        parameterName: `/${stage}/stripe/secret`,
      },
    ).stringValue;

    const STRIPE_EVENT_BUS_ID = StringParameter.fromStringParameterAttributes(
      this,
      `${serviceName}-event-bus-id-${stage}`,
      {
        parameterName: `/${stage}/stripe/event-bus-id`,
      },
    ).stringValue;

    const stripeUsageDLQ = new Queue(
      this,
      `${serviceName}-usage-dlq-${stage}`,
      {
        queueName: `${serviceName}-usage-dlq-${stage}`,
        removalPolicy:
          stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
        visibilityTimeout: Duration.minutes(5),
        retentionPeriod: Duration.days(14),
      },
    );

    const stripeUsageQueue = new Queue(
      this,
      `${serviceName}-usage-queue-${stage}`,
      {
        queueName: `${serviceName}-usage-queue-${stage}`,
        removalPolicy:
          stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
        visibilityTimeout: Duration.minutes(5),
        retentionPeriod: Duration.days(14),

        deadLetterQueue: {
          queue: stripeUsageDLQ,
          maxReceiveCount: 3,
        },
      },
    );

    const stripeEventBus = EventBus.fromEventBusArn(
      this,
      `${serviceName}-event-bus-${stage}`,
      `arn:aws:events:${this.region}::event-source/aws.partner/stripe.com/${STRIPE_EVENT_BUS_ID}`,
    );

    const targetEventBus = EventBus.fromEventBusName(
      this,
      `${serviceName}-target-event-bus-${stage}`,
      targetEventBusName,
    );

    new Rule(this, `${serviceName}-usage-rule`, {
      eventBus: targetEventBus,
      ruleName: `${serviceName}-usage-rule-${stage}`,
      description: "Rule to capture Stripe usage events",
      targets: [new SqsQueue(stripeUsageQueue)],
      eventPattern: {
        source: ["service.license"],
        detailType: ["UsageRecorded"],
      },
    });

    const sendUsageToStripeLambdaPath = path.join(
      __dirname,
      "../../src/functions/Lambda/SendUsageToStripe/SendUsageToStripe.handler.ts",
    );

    const sendUsageToStripeLogGroup = new LogGroup(
      this,
      `${serviceName}-send-usage-log-group-${stage}`,
      {
        logGroupName: `/aws/lambda/${serviceName}-send-usage-${stage}`,
        retention: 7,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );

    const sendUsageToStripeLambda = new TSLambdaFunction(
      this,
      `${serviceName}-send-usage-lambda-${stage}`,
      {
        serviceName,
        stage,
        handlerName: "sendUsageToStripeHandler",
        entryPath: sendUsageToStripeLambdaPath,
        tsConfigPath,
        functionName: `${serviceName}-send-usage-${stage}`,
        customOptions: {
          logGroup: sendUsageToStripeLogGroup,
          timeout: Duration.seconds(30),
          memorySize: 192, // Optimized: I/O bound (Stripe API + SQS)
          environment: {
            STRIPE_SECRET_KEY,
            STRIPE_ENTERPRISE_USAGE_PRICE_ID: StringParameter.fromStringParameterAttributes(
              this,
              `${serviceName}-enterprise-usage-price-id-${stage}`,
              {
                parameterName: `/${stage}/stripe/enterprise-usage-price-id`,
              },
            ).stringValue,
            STAGE: stage,
          },
        },
      },
    );

    sendUsageToStripeLambda.tsLambdaFunction.addEventSource(
      new SqsEventSource(stripeUsageQueue, {
        batchSize: 25,
        maxBatchingWindow: Duration.minutes(1),
        reportBatchItemFailures: true,
      }),
    );

    stripeUsageQueue.grantConsumeMessages(
      sendUsageToStripeLambda.tsLambdaFunction,
    );

    const schedulerRole = new Role(
      this,
      `${serviceName}-target-event-bus-scheduler-role-${stage}`,
      {
        assumedBy: new ServicePrincipal("scheduler.amazonaws.com"),
        description:
          "Role that EventBridge Scheduler uses to put events into the target bus",
      },
    );

    schedulerRole.addToPolicy(
      new PolicyStatement({
        actions: ["events:PutEvents"],
        resources: [targetEventBus.eventBusArn],
      }),
    );

    const productsTable = new Table(this, `${serviceName}-products-${stage}`, {
      tableName: `${serviceName}-stripe-products-${stage}`,
      partitionKey: { name: "PK", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      sortKey: { name: "SK", type: AttributeType.STRING },
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy:
        stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const idempotencyTable = new Table(this, `${serviceName}-idempotency-${stage}`, {
      tableName: `${serviceName}-stripe-idempotency-${stage}`,
      partitionKey: { name: "PK", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy:
        stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // Shared DLQ for EventBridge-triggered Lambda failures
    const eventHandlerDLQ = new Queue(
      this,
      `${serviceName}-event-handler-dlq-${stage}`,
      {
        queueName: `${serviceName}-event-handler-dlq-${stage}`,
        removalPolicy:
          stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
        retentionPeriod: Duration.days(14),
      },
    );

    const sessionEventConductorLambdaPath = path.join(
      __dirname,
      "../../src/functions/Lambda/SessionEventConductor/SessionEventConductor.handler.ts",
    );

    const sessionEventConductorLogGroup = new LogGroup(
      this,
      `${serviceName}-session-conductor-lambda-log-group-${stage}`,
      {
        logGroupName: `/aws/lambda/${serviceName}-session-conductor-${stage}`,
        retention: 7,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );

    const sessionEventConductorLambda = new TSLambdaFunction(
      this,
      `${serviceName}-session-conductor-lambda-${stage}`,
      {
        serviceName,
        stage,
        handlerName: "sessionEventConductorHandler",
        entryPath: sessionEventConductorLambdaPath,
        tsConfigPath,
        functionName: `${serviceName}-session-conductor-${stage}`,
        customOptions: {
          logGroup: sessionEventConductorLogGroup,
          timeout: Duration.seconds(30),
          memorySize: 1024, // Increased for complex subscription processing
          environment: {
            STRIPE_SECRET_KEY,
            STAGE: stage,
            TARGET_EVENT_BUS_NAME: targetEventBusName,
            IDEMPOTENCY_TABLE_NAME: idempotencyTable.tableName,
          },
        },
      },
    );

    targetEventBus.grantPutEventsTo(
      sessionEventConductorLambda.tsLambdaFunction,
    );
    idempotencyTable.grantReadWriteData(sessionEventConductorLambda.tsLambdaFunction);

    const sessionConductorRule = new Rule(
      this,
      `${serviceName}-session-conductor-rule-${stage}`,
      {
        eventBus: stripeEventBus,
        ruleName: `${serviceName}-session-conductor-rule-${stage}`,
        eventPattern: {
          source: [`aws.partner/stripe.com/${STRIPE_EVENT_BUS_ID}`],
          detailType: ["checkout.session.completed"],
        },
      },
    );

    sessionConductorRule.addTarget(
      new LambdaFunction(sessionEventConductorLambda.tsLambdaFunction, {
        deadLetterQueue: eventHandlerDLQ,
        maxEventAge: Duration.hours(1),
        retryAttempts: 2,
      }),
    );

    const subscriptionEventConductorPath = path.join(
      __dirname,
      "../../src/functions/Lambda/SubscriptionEventConductor/SubscriptionEventConductor.handler.ts",
    );

    const subscriptionEventConductorLogGroup = new LogGroup(
      this,
      `${serviceName}-subscription-conductor-log-group-${stage}`,
      {
        logGroupName: `/aws/lambda/${serviceName}-subscription-conductor-${stage}`,
        retention: 7,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );

    const subscriptionEventConductorLambda = new TSLambdaFunction(
      this,
      `${serviceName}-subscription-created-lambda-${stage}`,
      {
        serviceName,
        stage,
        handlerName: "subscriptionEventConductorHandler",
        entryPath: subscriptionEventConductorPath,
        tsConfigPath,
        functionName: `${serviceName}-subscription-conductor-${stage}`,
        customOptions: {
          logGroup: subscriptionEventConductorLogGroup,
          timeout: Duration.seconds(30),
          memorySize: 256,
          environment: {
            STRIPE_SECRET_KEY,
            STAGE: stage,
            TARGET_EVENT_BUS_NAME: targetEventBusName,
            SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
            EVENT_BUS_ARN: targetEventBus.eventBusArn,
            IDEMPOTENCY_TABLE_NAME: idempotencyTable.tableName,
          },
        },
      },
    );

    targetEventBus.grantPutEventsTo(
      subscriptionEventConductorLambda.tsLambdaFunction,
    );
    idempotencyTable.grantReadWriteData(subscriptionEventConductorLambda.tsLambdaFunction);

    const subscriptionConductorRule = new Rule(
      this,
      `${serviceName}-subscription-conductor-rule-${stage}`,
      {
        eventBus: stripeEventBus,
        ruleName: `${serviceName}-subscription-conductor-rule-${stage}`,
        eventPattern: {
          source: [`aws.partner/stripe.com/${STRIPE_EVENT_BUS_ID}`],
          detailType: [
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted",
            "customer.subscription.trial_will_end",
            "customer.subscription.paused",
            "customer.subscription.resumed",
          ],
        },
      },
    );

    subscriptionConductorRule.addTarget(
      new LambdaFunction(subscriptionEventConductorLambda.tsLambdaFunction, {
        deadLetterQueue: eventHandlerDLQ,
        maxEventAge: Duration.hours(1),
        retryAttempts: 2,
      }),
    );

    subscriptionEventConductorLambda.tsLambdaFunction.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "scheduler:CreateSchedule",
          "scheduler:UpdateSchedule",
          "scheduler:GetSchedule",
          "scheduler:DeleteSchedule",
        ],
        resources: [
          `arn:aws:scheduler:${this.region}:${this.account}:schedule/default/*`,
        ],
      }),
    );

    subscriptionEventConductorLambda.tsLambdaFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [schedulerRole.roleArn],
      }),
    );

    const sendQuantityChangeToStripeLambdaPath = path.join(
      __dirname,
      "../../src/functions/Lambda/SendQuantityChangeToStripe/SendQuantityChangeToStripe.handler.ts",
    );

    const sendQuantityChangeToStripeLogGroup = new LogGroup(
      this,
      `${serviceName}-send-quantity-change-stripe-log-group-${stage}`,
      {
        logGroupName: `/aws/lambda/${serviceName}-send-quantity-change-stripe-${stage}`,
        retention: 7,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );

    const sendQuantityChangeToStripeLambda = new TSLambdaFunction(
      this,
      `${serviceName}-send-quantity-change-stripe-lambda-${stage}`,
      {
        serviceName,
        stage,
        handlerName: "sendQuantityChangeToStripeHandler",
        entryPath: sendQuantityChangeToStripeLambdaPath,
        tsConfigPath,
        functionName: `${serviceName}-send-quantity-change-stripe-${stage}`,
        customOptions: {
          logGroup: sendQuantityChangeToStripeLogGroup,
          timeout: Duration.seconds(30),
          memorySize: 256,
          environment: {
            STRIPE_SECRET_KEY,
            STAGE: stage,
          },
        },
      },
    );

    const sendQuantityChangeToStripeRule = new Rule(
      this,
      `${serviceName}-send-quantity-change-stripe-rule-${stage}`,
      {
        eventBus: targetEventBus,
        ruleName: `${serviceName}-send-quantity-change-stripe-rule-${stage}`,
        eventPattern: {
          source: ["service.license"],
          detailType: ["LicenseCancelled", "LicenseUncancelled"],
        },
      },
    );

    sendQuantityChangeToStripeRule.addTarget(
      new LambdaFunction(sendQuantityChangeToStripeLambda.tsLambdaFunction, {
        deadLetterQueue: eventHandlerDLQ,
        maxEventAge: Duration.hours(1),
        retryAttempts: 2,
      }),
    );

    // Invoice Created Lambda
    const invoiceCreatedLambdaPath = path.join(
      __dirname,
      "../../src/functions/Lambda/InvoiceCreated/InvoiceCreated.handler.ts",
    );

    const invoiceCreatedLogGroup = new LogGroup(
      this,
      `${serviceName}-invoice-created-log-group-${stage}`,
      {
        logGroupName: `/aws/lambda/${serviceName}-invoice-created-${stage}`,
        retention: 7,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );

    const invoiceCreatedLambda = new TSLambdaFunction(
      this,
      `${serviceName}-invoice-created-lambda-${stage}`,
      {
        serviceName,
        stage,
        handlerName: "invoiceCreatedHandler",
        entryPath: invoiceCreatedLambdaPath,
        tsConfigPath,
        functionName: `${serviceName}-invoice-created-${stage}`,
        customOptions: {
          logGroup: invoiceCreatedLogGroup,
          timeout: Duration.seconds(30),
          memorySize: 192, // Optimized: I/O bound (Stripe + EventBridge)
          environment: {
            STRIPE_SECRET_KEY,
            STAGE: stage,
            TARGET_EVENT_BUS_NAME: targetEventBusName,
            IDEMPOTENCY_TABLE_NAME: idempotencyTable.tableName,
          },
        },
      },
    );

    targetEventBus.grantPutEventsTo(invoiceCreatedLambda.tsLambdaFunction);
    idempotencyTable.grantReadWriteData(invoiceCreatedLambda.tsLambdaFunction);

    // Invoice Payment Succeeded Lambda
    const invoicePaymentSucceededLambdaPath = path.join(
      __dirname,
      "../../src/functions/Lambda/InvoicePaymentSucceeded/InvoicePaymentSucceeded.handler.ts",
    );

    const invoicePaymentSucceededLogGroup = new LogGroup(
      this,
      `${serviceName}-invoice-payment-succeeded-log-group-${stage}`,
      {
        logGroupName: `/aws/lambda/${serviceName}-invoice-payment-succeeded-${stage}`,
        retention: 7,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );

    const invoicePaymentSucceededLambda = new TSLambdaFunction(
      this,
      `${serviceName}-invoice-payment-succeeded-lambda-${stage}`,
      {
        serviceName,
        stage,
        handlerName: "invoicePaymentSucceededHandler",
        entryPath: invoicePaymentSucceededLambdaPath,
        tsConfigPath,
        functionName: `${serviceName}-invoice-payment-succeeded-${stage}`,
        customOptions: {
          logGroup: invoicePaymentSucceededLogGroup,
          timeout: Duration.seconds(30),
          memorySize: 192, // Optimized: I/O bound (Stripe + EventBridge)
          environment: {
            STRIPE_SECRET_KEY,
            STAGE: stage,
            TARGET_EVENT_BUS_NAME: targetEventBusName,
            IDEMPOTENCY_TABLE_NAME: idempotencyTable.tableName,
          },
        },
      },
    );

    targetEventBus.grantPutEventsTo(invoicePaymentSucceededLambda.tsLambdaFunction);
    idempotencyTable.grantReadWriteData(invoicePaymentSucceededLambda.tsLambdaFunction);

    // Invoice Payment Failed Lambda
    const invoicePaymentFailedLambdaPath = path.join(
      __dirname,
      "../../src/functions/Lambda/InvoicePaymentFailed/InvoicePaymentFailed.handler.ts",
    );

    const invoicePaymentFailedLogGroup = new LogGroup(
      this,
      `${serviceName}-invoice-payment-failed-log-group-${stage}`,
      {
        logGroupName: `/aws/lambda/${serviceName}-invoice-payment-failed-${stage}`,
        retention: 7,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );

    const invoicePaymentFailedLambda = new TSLambdaFunction(
      this,
      `${serviceName}-invoice-payment-failed-lambda-${stage}`,
      {
        serviceName,
        stage,
        handlerName: "invoicePaymentFailedHandler",
        entryPath: invoicePaymentFailedLambdaPath,
        tsConfigPath,
        functionName: `${serviceName}-invoice-payment-failed-${stage}`,
        customOptions: {
          logGroup: invoicePaymentFailedLogGroup,
          timeout: Duration.seconds(30),
          memorySize: 192, // Optimized: I/O bound (Stripe + EventBridge)
          environment: {
            STRIPE_SECRET_KEY,
            STAGE: stage,
            TARGET_EVENT_BUS_NAME: targetEventBusName,
            IDEMPOTENCY_TABLE_NAME: idempotencyTable.tableName,
          },
        },
      },
    );

    targetEventBus.grantPutEventsTo(invoicePaymentFailedLambda.tsLambdaFunction);
    idempotencyTable.grantReadWriteData(invoicePaymentFailedLambda.tsLambdaFunction);

    // Payment Method Attached Lambda
    const paymentMethodAttachedLambdaPath = path.join(
      __dirname,
      "../../src/functions/Lambda/PaymentMethodAttached/PaymentMethodAttached.handler.ts",
    );

    const paymentMethodAttachedLogGroup = new LogGroup(
      this,
      `${serviceName}-payment-method-attached-log-group-${stage}`,
      {
        logGroupName: `/aws/lambda/${serviceName}-payment-method-attached-${stage}`,
        retention: 7,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );

    const paymentMethodAttachedLambda = new TSLambdaFunction(
      this,
      `${serviceName}-payment-method-attached-lambda-${stage}`,
      {
        serviceName,
        stage,
        handlerName: "paymentMethodAttachedHandler",
        entryPath: paymentMethodAttachedLambdaPath,
        tsConfigPath,
        functionName: `${serviceName}-payment-method-attached-${stage}`,
        customOptions: {
          logGroup: paymentMethodAttachedLogGroup,
          timeout: Duration.seconds(30),
          memorySize: 192, // Optimized: I/O bound (Stripe + EventBridge)
          environment: {
            STRIPE_SECRET_KEY,
            STAGE: stage,
            TARGET_EVENT_BUS_NAME: targetEventBusName,
            IDEMPOTENCY_TABLE_NAME: idempotencyTable.tableName,
          },
        },
      },
    );

    targetEventBus.grantPutEventsTo(paymentMethodAttachedLambda.tsLambdaFunction);
    idempotencyTable.grantReadWriteData(paymentMethodAttachedLambda.tsLambdaFunction);

    // Setup Intent Succeeded Lambda
    const setupIntentSucceededLambdaPath = path.join(
      __dirname,
      "../../src/functions/Lambda/SetupIntentSucceeded/SetupIntentSucceeded.handler.ts",
    );

    const setupIntentSucceededLogGroup = new LogGroup(
      this,
      `${serviceName}-setup-intent-succeeded-log-group-${stage}`,
      {
        logGroupName: `/aws/lambda/${serviceName}-setup-intent-succeeded-${stage}`,
        retention: 7,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );

    const setupIntentSucceededLambda = new TSLambdaFunction(
      this,
      `${serviceName}-setup-intent-succeeded-lambda-${stage}`,
      {
        serviceName,
        stage,
        handlerName: "setupIntentSucceededHandler",
        entryPath: setupIntentSucceededLambdaPath,
        tsConfigPath,
        functionName: `${serviceName}-setup-intent-succeeded-${stage}`,
        customOptions: {
          logGroup: setupIntentSucceededLogGroup,
          timeout: Duration.seconds(30),
          memorySize: 192, // Optimized: I/O bound (Stripe + EventBridge)
          environment: {
            STRIPE_SECRET_KEY,
            STAGE: stage,
            TARGET_EVENT_BUS_NAME: targetEventBusName,
            IDEMPOTENCY_TABLE_NAME: idempotencyTable.tableName,
          },
        },
      },
    );

    targetEventBus.grantPutEventsTo(setupIntentSucceededLambda.tsLambdaFunction);
    idempotencyTable.grantReadWriteData(setupIntentSucceededLambda.tsLambdaFunction);

    // Customer Created Lambda
    const customerCreatedLambdaPath = path.join(
      __dirname,
      "../../src/functions/Lambda/CustomerCreated/CustomerCreated.handler.ts",
    );

    const customerCreatedLogGroup = new LogGroup(
      this,
      `${serviceName}-customer-created-log-group-${stage}`,
      {
        logGroupName: `/aws/lambda/${serviceName}-customer-created-${stage}`,
        retention: 7,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );

    const customerCreatedLambda = new TSLambdaFunction(
      this,
      `${serviceName}-customer-created-lambda-${stage}`,
      {
        serviceName,
        stage,
        handlerName: "customerCreatedHandler",
        entryPath: customerCreatedLambdaPath,
        tsConfigPath,
        functionName: `${serviceName}-customer-created-${stage}`,
        customOptions: {
          logGroup: customerCreatedLogGroup,
          timeout: Duration.seconds(30),
          memorySize: 192, // Optimized: I/O bound (Stripe + EventBridge)
          environment: {
            STRIPE_SECRET_KEY,
            STAGE: stage,
            TARGET_EVENT_BUS_NAME: targetEventBusName,
            IDEMPOTENCY_TABLE_NAME: idempotencyTable.tableName,
          },
        },
      },
    );

    targetEventBus.grantPutEventsTo(customerCreatedLambda.tsLambdaFunction);
    idempotencyTable.grantReadWriteData(customerCreatedLambda.tsLambdaFunction);

    // Subscription Pause Requested Lambda (from service-license usage cap)
    const subscriptionPauseRequestedLambdaPath = path.join(
      __dirname,
      "../../src/functions/Lambda/SubscriptionPauseRequested/SubscriptionPauseRequested.handler.ts",
    );

    const subscriptionPauseRequestedLogGroup = new LogGroup(
      this,
      `${serviceName}-subscription-pause-requested-log-group-${stage}`,
      {
        logGroupName: `/aws/lambda/${serviceName}-subscription-pause-requested-${stage}`,
        retention: 7,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );

    const subscriptionPauseRequestedLambda = new TSLambdaFunction(
      this,
      `${serviceName}-subscription-pause-requested-lambda-${stage}`,
      {
        serviceName,
        stage,
        handlerName: "subscriptionPauseRequestedHandler",
        entryPath: subscriptionPauseRequestedLambdaPath,
        tsConfigPath,
        functionName: `${serviceName}-subscription-pause-requested-${stage}`,
        customOptions: {
          logGroup: subscriptionPauseRequestedLogGroup,
          timeout: Duration.seconds(30),
          memorySize: 192, // Optimized: I/O bound (Stripe API call only)
          environment: {
            STRIPE_SECRET_KEY,
            STAGE: stage,
          },
        },
      },
    );

    // Listen on the target bus for pause requests from service-license
    const subscriptionPauseRequestedRule = new Rule(
      this,
      `${serviceName}-subscription-pause-requested-rule-${stage}`,
      {
        eventBus: targetEventBus,
        ruleName: `${serviceName}-subscription-pause-requested-rule-${stage}`,
        eventPattern: {
          source: ["service.license"],
          detailType: ["SubscriptionPauseRequested"],
        },
      },
    );

    subscriptionPauseRequestedRule.addTarget(
      new LambdaFunction(subscriptionPauseRequestedLambda.tsLambdaFunction, {
        deadLetterQueue: eventHandlerDLQ,
        maxEventAge: Duration.hours(1),
        retryAttempts: 2,
      }),
    );

    // EventBridge Rules for new handlers
    const invoiceCreatedRule = new Rule(
      this,
      `${serviceName}-invoice-created-rule-${stage}`,
      {
        eventBus: stripeEventBus,
        ruleName: `${serviceName}-invoice-created-rule-${stage}`,
        eventPattern: {
          source: [`aws.partner/stripe.com/${STRIPE_EVENT_BUS_ID}`],
          detailType: ["invoice.created"],
        },
      },
    );

    invoiceCreatedRule.addTarget(
      new LambdaFunction(invoiceCreatedLambda.tsLambdaFunction, {
        deadLetterQueue: eventHandlerDLQ,
        maxEventAge: Duration.hours(1),
        retryAttempts: 2,
      }),
    );

    const invoicePaymentSucceededRule = new Rule(
      this,
      `${serviceName}-invoice-payment-succeeded-rule-${stage}`,
      {
        eventBus: stripeEventBus,
        ruleName: `${serviceName}-invoice-payment-succeeded-rule-${stage}`,
        eventPattern: {
          source: [`aws.partner/stripe.com/${STRIPE_EVENT_BUS_ID}`],
          detailType: ["invoice.payment_succeeded"],
        },
      },
    );

    invoicePaymentSucceededRule.addTarget(
      new LambdaFunction(invoicePaymentSucceededLambda.tsLambdaFunction, {
        deadLetterQueue: eventHandlerDLQ,
        maxEventAge: Duration.hours(1),
        retryAttempts: 2,
      }),
    );

    const invoicePaymentFailedRule = new Rule(
      this,
      `${serviceName}-invoice-payment-failed-rule-${stage}`,
      {
        eventBus: stripeEventBus,
        ruleName: `${serviceName}-invoice-payment-failed-rule-${stage}`,
        eventPattern: {
          source: [`aws.partner/stripe.com/${STRIPE_EVENT_BUS_ID}`],
          detailType: ["invoice.payment_failed"],
        },
      },
    );

    invoicePaymentFailedRule.addTarget(
      new LambdaFunction(invoicePaymentFailedLambda.tsLambdaFunction, {
        deadLetterQueue: eventHandlerDLQ,
        maxEventAge: Duration.hours(1),
        retryAttempts: 2,
      }),
    );

    const paymentMethodAttachedRule = new Rule(
      this,
      `${serviceName}-payment-method-attached-rule-${stage}`,
      {
        eventBus: stripeEventBus,
        ruleName: `${serviceName}-payment-method-attached-rule-${stage}`,
        eventPattern: {
          source: [`aws.partner/stripe.com/${STRIPE_EVENT_BUS_ID}`],
          detailType: ["payment_method.attached"],
        },
      },
    );

    paymentMethodAttachedRule.addTarget(
      new LambdaFunction(paymentMethodAttachedLambda.tsLambdaFunction, {
        deadLetterQueue: eventHandlerDLQ,
        maxEventAge: Duration.hours(1),
        retryAttempts: 2,
      }),
    );

    const customerCreatedRule = new Rule(
      this,
      `${serviceName}-customer-created-rule-${stage}`,
      {
        eventBus: stripeEventBus,
        ruleName: `${serviceName}-customer-created-rule-${stage}`,
        eventPattern: {
          source: [`aws.partner/stripe.com/${STRIPE_EVENT_BUS_ID}`],
          detailType: ["customer.created"],
        },
      },
    );

    customerCreatedRule.addTarget(
      new LambdaFunction(customerCreatedLambda.tsLambdaFunction, {
        deadLetterQueue: eventHandlerDLQ,
        maxEventAge: Duration.hours(1),
        retryAttempts: 2,
      }),
    );

    // Setup Intent Succeeded Rule
    const setupIntentSucceededRule = new Rule(
      this,
      `${serviceName}-setup-intent-succeeded-rule-${stage}`,
      {
        eventBus: stripeEventBus,
        ruleName: `${serviceName}-setup-intent-succeeded-rule-${stage}`,
        eventPattern: {
          source: [`aws.partner/stripe.com/${STRIPE_EVENT_BUS_ID}`],
          detailType: ["setup_intent.succeeded"],
        },
      },
    );

    setupIntentSucceededRule.addTarget(
      new LambdaFunction(setupIntentSucceededLambda.tsLambdaFunction, {
        deadLetterQueue: eventHandlerDLQ,
        maxEventAge: Duration.hours(1),
        retryAttempts: 2,
      }),
    );

    // ============================================================================
    // GDPR ACCOUNT DELETION - ARCHIVE STRIPE CUSTOMER
    // Handles ArchiveStripeCustomer event from service-user
    // ============================================================================

    const archiveStripeCustomerLambdaPath = path.join(
      __dirname,
      "../../src/functions/Lambda/ArchiveStripeCustomer/ArchiveStripeCustomer.handler.ts",
    );

    const archiveStripeCustomerLogGroup = new LogGroup(
      this,
      `${serviceName}-archive-stripe-customer-log-group-${stage}`,
      {
        logGroupName: `/aws/lambda/${serviceName}-archive-stripe-customer-${stage}`,
        retention: 7,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );

    const archiveStripeCustomerLambda = new TSLambdaFunction(
      this,
      `${serviceName}-archive-stripe-customer-lambda-${stage}`,
      {
        serviceName,
        stage,
        handlerName: "handler",
        entryPath: archiveStripeCustomerLambdaPath,
        tsConfigPath,
        functionName: `${serviceName}-archive-stripe-customer-${stage}`,
        customOptions: {
          logGroup: archiveStripeCustomerLogGroup,
          timeout: Duration.seconds(30),
          memorySize: 192,
          environment: {
            STRIPE_SECRET_KEY,
            STAGE: stage,
            TARGET_EVENT_BUS_NAME: targetEventBusName,
          },
        },
      },
    );

    targetEventBus.grantPutEventsTo(archiveStripeCustomerLambda.tsLambdaFunction);

    // EventBridge rule for GDPR account deletion - Archive Stripe Customer
    const archiveStripeCustomerRule = new Rule(
      this,
      `${serviceName}-archive-stripe-customer-rule-${stage}`,
      {
        eventBus: targetEventBus,
        ruleName: `${serviceName}-archive-stripe-customer-rule-${stage}`,
        eventPattern: {
          source: ["service.user"],
          detailType: ["ArchiveStripeCustomer"],
        },
      },
    );

    archiveStripeCustomerRule.addTarget(
      new LambdaFunction(archiveStripeCustomerLambda.tsLambdaFunction, {
        deadLetterQueue: eventHandlerDLQ,
        maxEventAge: Duration.hours(1),
        retryAttempts: 2,
      }),
    );

    // ============================================================================
    // CLOUDWATCH ALARMS
    // Wired to the centralised CDK Insights alerting SNS topic
    // ============================================================================

    const alertingTopicArn = StringParameter.fromStringParameterAttributes(
      this,
      `${serviceName}-alerting-topic-arn-${stage}`,
      {
        parameterName: `/${stage}/cdkinsights/alerting/sns-topic-arn`,
      },
    ).stringValue;

    const alertingTopic = Topic.fromTopicArn(
      this,
      `${serviceName}-alerting-topic-ref-${stage}`,
      alertingTopicArn,
    );

    const dlqAlarm = new Alarm(
      this,
      `${serviceName}-event-handler-dlq-alarm-${stage}`,
      {
        alarmName: `${serviceName}-event-handler-dlq-not-empty-${stage}`,
        alarmDescription:
          `[service-stripe] [${stage}] Failed Stripe events detected in DLQ. ` +
          "Events landed here after exhausting all retries (1 initial + 2 retries). " +
          "Check CloudWatch logs for the failing Lambda handler, then redrive messages from the DLQ.",
        metric: eventHandlerDLQ.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      },
    );

    dlqAlarm.addAlarmAction(new SnsAction(alertingTopic));

    const usageDlqAlarm = new Alarm(
      this,
      `${serviceName}-usage-dlq-alarm-${stage}`,
      {
        alarmName: `${serviceName}-usage-dlq-not-empty-${stage}`,
        alarmDescription:
          `[service-stripe] [${stage}] Failed usage metering events in DLQ. ` +
          "Usage records failed to be sent to Stripe after 3 attempts. " +
          "Check the SendUsageToStripe Lambda logs and redrive messages from the DLQ.",
        metric: stripeUsageDLQ.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      },
    );

    usageDlqAlarm.addAlarmAction(new SnsAction(alertingTopic));
  }
}
