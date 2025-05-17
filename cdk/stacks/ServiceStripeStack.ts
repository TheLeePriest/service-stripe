import type { Construct } from "constructs";
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import type { StripeStackProps } from "../types/stacks.types";
import { AttributeType, StreamViewType, Table } from "aws-cdk-lib/aws-dynamodb";
import { TSLambdaFunction } from "the-ldk";
import path from "node:path";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { EventBus, Rule } from "aws-cdk-lib/aws-events";

export class ServiceStripeStack extends Stack {
	constructor(scope: Construct, id: string, props: StripeStackProps) {
		super(scope, id, props);

		const { stage, targetEventBusName } = props;
		const tsConfigPath = path.join(__dirname, "../../tsconfig.json");

		const STRIPE_SECRET_KEY = StringParameter.fromStringParameterAttributes(
			this,
			`stripe-secret-key-${stage}`,
			{
				parameterName: `/${stage}/stripe/secret`,
			},
		).stringValue;

		const STRIPE_EVENT_BUS_ID = StringParameter.fromStringParameterAttributes(
			this,
			`stripe-event-bus-id-${stage}`,
			{
				parameterName: `/${stage}/stripe/event-bus-id`,
			},
		).stringValue;

		const stripeEventBus = EventBus.fromEventBusArn(
			this,
			`stripe-event-bus-${stage}`,
			`arn:aws:events:${this.region}::event-source/aws.partner/stripe.com/${STRIPE_EVENT_BUS_ID}`,
		);

		const targetEventBus = EventBus.fromEventBusName(
			this,
			`target-event-bus-${stage}`,
			targetEventBusName,
		);

		const productsTable = new Table(this, `stripe-products-${stage}`, {
			tableName: `stripe-products-${stage}`,
			partitionKey: { name: "PK", type: AttributeType.STRING },
			sortKey: { name: "SK", type: AttributeType.STRING },
			stream: StreamViewType.NEW_AND_OLD_IMAGES,
			removalPolicy:
				stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
		});

		const createProductLambdaPath = path.join(
			__dirname,
			"../../src/functions/Lambda/CreateProduct/CreateProduct.handler.ts",
		);

		const createProductLogGroup = new LogGroup(
			this,
			`create-product-log-group-${stage}`,
			{
				logGroupName: `/aws/lambda/create-product-${stage}`,
				retention: 7,
				removalPolicy: RemovalPolicy.DESTROY,
			},
		);

		const createProductLambda = new TSLambdaFunction(
			this,
			`create-product-lambda-${stage}`,
			{
				serviceName: "cdk-insights",
				stage,
				handlerName: "createProductHandler",
				entryPath: createProductLambdaPath,
				tsConfigPath,
				functionName: `create-product-${stage}`,
				customOptions: {
					logGroup: createProductLogGroup,
					timeout: Duration.seconds(30),
					memorySize: 256,
					environment: {
						STRIPE_SECRET_KEY,
						PRODUCTS_TABLE_NAME: productsTable.tableName,
						TARGET_EVENT_BUS_NAME: targetEventBusName,
					},
				},
			},
		);

		const newPriceCreatedRule = new Rule(
			this,
			`stripe-product-created-rule-${stage}`,
			{
				eventBus: stripeEventBus,
				ruleName: `price-created-rule-${stage}`,
				eventPattern: {
					source: [`aws.partner/stripe.com/${STRIPE_EVENT_BUS_ID}`],
					detailType: ["price.created"],
				},
			},
		);

		newPriceCreatedRule.addTarget(
			new LambdaFunction(createProductLambda.tsLambdaFunction),
		);

		productsTable.grantReadWriteData(createProductLambda.tsLambdaFunction);

		const updateProductLambdaPath = path.join(
			__dirname,
			"../../src/functions/Lambda/UpdateProduct/UpdateProduct.handler.ts",
		);

		const updateProductLogGroup = new LogGroup(
			this,
			`update-product-log-group-${stage}`,
			{
				logGroupName: `/aws/lambda/update-product-${stage}`,
				retention: 7,
				removalPolicy: RemovalPolicy.DESTROY,
			},
		);

		const updateProductLambda = new TSLambdaFunction(
			this,
			`update-product-lambda-${stage}`,
			{
				serviceName: "cdk-insights",
				stage,
				handlerName: "updateProductHandler",
				entryPath: updateProductLambdaPath,
				tsConfigPath,
				functionName: `update-product-${stage}`,
				customOptions: {
					logGroup: updateProductLogGroup,
					timeout: Duration.seconds(30),
					memorySize: 256,
					environment: {
						STRIPE_SECRET_KEY,
						PRODUCTS_TABLE_NAME: productsTable.tableName,
						TARGET_EVENT_BUS_NAME: targetEventBusName,
					},
				},
			},
		);

		const priceUpdatedRule = new Rule(
			this,
			`stripe-product-updated-rule-${stage}`,
			{
				eventBus: stripeEventBus,
				ruleName: `price-updated-rule-${stage}`,
				eventPattern: {
					source: [`aws.partner/stripe.com/${STRIPE_EVENT_BUS_ID}`],
					detailType: ["price.updated"],
				},
			},
		);

		priceUpdatedRule.addTarget(
			new LambdaFunction(updateProductLambda.tsLambdaFunction),
		);

		productsTable.grantReadWriteData(updateProductLambda.tsLambdaFunction);

		const deleteProductLambdaPath = path.join(
			__dirname,
			"../../src/functions/Lambda/DeleteProduct/DeleteProduct.handler.ts",
		);

		const deleteProductLogGroup = new LogGroup(
			this,
			`product-deleted-log-group-${stage}`,
			{
				logGroupName: `/aws/lambda/delete-product-${stage}`,
				retention: 7,
				removalPolicy: RemovalPolicy.DESTROY,
			},
		);

		const deleteProductLambda = new TSLambdaFunction(
			this,
			`delete-product-lambda-${stage}`,
			{
				serviceName: "cdk-insights",
				stage,
				handlerName: "deleteProductHandler",
				entryPath: deleteProductLambdaPath,
				tsConfigPath,
				functionName: `delete-product-${stage}`,
				customOptions: {
					logGroup: deleteProductLogGroup,
					timeout: Duration.seconds(30),
					memorySize: 256,
					environment: {
						STAGE: stage,
						STRIPE_SECRET_KEY,
						PRODUCTS_TABLE_NAME: productsTable.tableName,
					},
				},
			},
		);

		const productDeletedRule = new Rule(
			this,
			`stripe-product-deleted-rule-${stage}`,
			{
				eventBus: stripeEventBus,
				ruleName: `product-deleted-rule-${stage}`,
				eventPattern: {
					source: [`aws.partner/stripe.com/${STRIPE_EVENT_BUS_ID}`],
					detailType: ["product.deleted", "price.deleted"],
				},
			},
		);

		productDeletedRule.addTarget(
			new LambdaFunction(deleteProductLambda.tsLambdaFunction),
		);

		productsTable.grantReadWriteData(deleteProductLambda.tsLambdaFunction);

		const sessionEventConductorLambdaPath = path.join(
			__dirname,
			"../../src/functions/Lambda/SessionEventConductor/SessionEventConductor.handler.ts",
		);

		const sessionEventConductorLogGroup = new LogGroup(
			this,
			`stripe-session-conductor-lambda-log-group-${stage}`,
			{
				logGroupName: `/aws/lambda/stripe-session-conductor-${stage}`,
				retention: 7,
				removalPolicy: RemovalPolicy.DESTROY,
			},
		);

		const sessionEventConductorLambda = new TSLambdaFunction(
			this,
			`stripe-session-conductor-lambda-${stage}`,
			{
				serviceName: "cdk-insights",
				stage,
				handlerName: "sessionEventConductorHandler",
				entryPath: sessionEventConductorLambdaPath,
				tsConfigPath,
				functionName: `cdk-insights-stripe-session-conductor-${stage}`,
				customOptions: {
					logGroup: sessionEventConductorLogGroup,
					timeout: Duration.seconds(30),
					memorySize: 256,
					environment: {
						STRIPE_SECRET_KEY,
						STAGE: stage,
						TARGET_EVENT_BUS_NAME: targetEventBusName,
					},
				},
			},
		);

		targetEventBus.grantPutEventsTo(
			sessionEventConductorLambda.tsLambdaFunction,
		);

		const sessionConductorRule = new Rule(
			this,
			`stripe-session-conductor-rule-${stage}`,
			{
				eventBus: stripeEventBus,
				ruleName: `session-conductor-rule-${stage}`,
				eventPattern: {
					source: [`aws.partner/stripe.com/${STRIPE_EVENT_BUS_ID}`],
					detailType: ["checkout.session.completed"],
				},
			},
		);

		sessionConductorRule.addTarget(
			new LambdaFunction(sessionEventConductorLambda.tsLambdaFunction),
		);

		const subscriptionEventConductorPath = path.join(
			__dirname,
			"../../src/functions/Lambda/SubscriptionEventConductor/SubscriptionEventConductor.handler.ts",
		);

		const subscriptionEventConductorLogGroup = new LogGroup(
			this,
			`stripe-subscription-conductor-log-group-${stage}`,
			{
				logGroupName: `/aws/lambda/stripe-subscription-conductor-${stage}`,
				retention: 7,
				removalPolicy: RemovalPolicy.DESTROY,
			},
		);

		const subscriptionEventConductorLambda = new TSLambdaFunction(
			this,
			`stripe-subscription-created-lambda-${stage}`,
			{
				serviceName: "cdk-insights",
				stage,
				handlerName: "subscriptionEventConductorHandler",
				entryPath: subscriptionEventConductorPath,
				tsConfigPath,
				functionName: `cdk-insights-subscription-conductor-${stage}`,
				customOptions: {
					logGroup: subscriptionEventConductorLogGroup,
					timeout: Duration.seconds(30),
					memorySize: 256,
					environment: {
						STRIPE_SECRET_KEY,
						STAGE: stage,
						TARGET_EVENT_BUS_NAME: targetEventBusName,
					},
				},
			},
		);

		targetEventBus.grantPutEventsTo(
			subscriptionEventConductorLambda.tsLambdaFunction,
		);

		const subscriptionConductorRule = new Rule(
			this,
			`stripe-subscription-conductor-rule-${stage}`,
			{
				eventBus: stripeEventBus,
				ruleName: `subscription-conductor-rule-${stage}`,
				eventPattern: {
					source: [`aws.partner/stripe.com/${STRIPE_EVENT_BUS_ID}`],
					detailType: [
						"customer.subscription.created",
						"customer.subscription.updated",
						"customer.subscription.deleted",
					],
				},
			},
		);

		subscriptionConductorRule.addTarget(
			new LambdaFunction(subscriptionEventConductorLambda.tsLambdaFunction),
		);
	}
}
