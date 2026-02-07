import type { EventBridgeEvent } from "aws-lambda";
import type { InvoicePaymentSucceededEvent, InvoicePaymentSucceededDependencies } from "./InvoicePaymentSucceeded.types";
import { sendEvent } from "../lib/sendEvent";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";
import type Stripe from "stripe";

export const invoicePaymentSucceeded =
  ({
    stripe,
    eventBridgeClient,
    eventBusName,
    dynamoDBClient,
    idempotencyTableName,
    logger,
  }: InvoicePaymentSucceededDependencies) =>
  async (event: EventBridgeEvent<string, unknown>) => {
    logger.info("InvoicePaymentSucceeded handler invoked", {
      eventId: event.id,
      source: event.source,
      detailType: event["detail-type"],
      time: event.time,
      region: event.region,
      account: event.account,
    });

    logger.debug("Raw event structure", {
      eventId: event.id,
      detailType: event["detail-type"],
    });

    try {
      // Extract the Stripe event from the EventBridge event
      const stripeEvent = event.detail as Record<string, unknown>;

      logger.info("Extracted Stripe event", {
        stripeEventType: stripeEvent.type,
        stripeEventId: stripeEvent.id,
        hasData: !!stripeEvent.data,
        hasObject: !!(stripeEvent.data as Record<string, unknown>)?.object,
      });

      const stripeData = stripeEvent.data as Record<string, unknown>;
      if (!stripeData?.object) {
        logger.error("Missing stripe event data.object", {
          stripeEvent: stripeEvent,
        });
        throw new Error("Invalid Stripe event structure: missing data.object");
      }

      const invoice = stripeData.object as Record<string, unknown>;
      
      logger.info("Extracted invoice data", {
        invoiceId: invoice.id,
        customerId: invoice.customer,
        subscriptionId: invoice.subscription,
        status: invoice.status,
        amountPaid: invoice.amount_paid,
        currency: invoice.currency,
        created: invoice.created,
      });

      // Check for required fields with proper field name mapping
      const stripeInvoiceId = invoice.id as string;
      const customer = invoice.customer as string;
      const subscription = invoice.subscription as string | undefined;
      const status = invoice.status as string;
      const amount_paid = invoice.amount_paid as number;
      const currency = invoice.currency as string;
      const created = invoice.created as number;

      if (!stripeInvoiceId || !customer || !status || amount_paid === undefined || !currency) {
        logger.error("Missing required invoice fields", {
          invoiceId: stripeInvoiceId,
          customerId: customer,
          status: status,
          amountPaid: amount_paid,
          currency: currency,
        });
        throw new Error("Invoice missing required fields: id, customer, status, amount_paid, or currency");
      }

      // Generate idempotency key
      const eventId = generateEventId("invoice-payment-succeeded", stripeInvoiceId, created);
      
      // Check idempotency
      const idempotencyResult = await ensureIdempotency(
        { dynamoDBClient, tableName: idempotencyTableName, logger },
        eventId,
        { 
          invoiceId: stripeInvoiceId, 
          customerId: customer,
          subscriptionId: subscription,
          status,
          amountPaid: amount_paid,
          currency
        }
      );

      if (idempotencyResult.isDuplicate) {
        logger.info("Invoice payment already processed, skipping", { 
          invoiceId: stripeInvoiceId,
          eventId 
        });
        return;
      }

      // Retrieve customer details
      const customerData = await stripe.customers.retrieve(customer) as Stripe.Customer;

      // Check if this payment represents a renewal by fetching current subscription details
      let isRenewal = false;
      let renewalData: {
        currentPeriodStart: string;
        currentPeriodEnd: string;
        cancelAtPeriodEnd: boolean;
      } | null = null;

      if (subscription) {
        try {
          logger.debug("Fetching subscription details to check for renewal", {
            subscriptionId: subscription,
          });

          const stripeSubscription = await stripe.subscriptions.retrieve(subscription);

          // Check if this is a renewal by comparing current period start with the invoice creation time
          // A renewal typically has a current_period_start that's close to or after the invoice creation
          const invoiceTime = created * 1000; // Convert to milliseconds
          const periodStart = stripeSubscription.items.data[0]?.current_period_start;
          const periodEnd = stripeSubscription.items.data[0]?.current_period_end;
          const periodStartTime = periodStart ? periodStart * 1000 : 0;
          const timeDifference = Math.abs(invoiceTime - periodStartTime);

          // Consider it a renewal if the period start is within 24 hours of the invoice creation
          // This accounts for timezone differences and slight delays in webhook processing
          const RENEWAL_TIME_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

          isRenewal = timeDifference <= RENEWAL_TIME_THRESHOLD &&
                     stripeSubscription.status === 'active' &&
                     !stripeSubscription.cancel_at_period_end;

          if (isRenewal) {
            renewalData = {
              currentPeriodStart: periodStart?.toString() || "",
              currentPeriodEnd: periodEnd?.toString() || "",
              cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
            };

            logger.info("Payment identified as renewal", {
              subscriptionId: subscription,
              invoiceTime: new Date(invoiceTime).toISOString(),
              periodStartTime: new Date(periodStartTime).toISOString(),
              timeDifference: `${Math.round(timeDifference / (1000 * 60))} minutes`,
              isRenewal,
            });
          } else {
            logger.debug("Payment not identified as renewal", {
              subscriptionId: subscription,
              invoiceTime: new Date(invoiceTime).toISOString(),
              periodStartTime: new Date(periodStartTime).toISOString(),
              timeDifference: `${Math.round(timeDifference / (1000 * 60))} minutes`,
              subscriptionStatus: stripeSubscription.status,
              cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
            });
          }
        } catch (stripeError) {
          logger.warn("Failed to fetch subscription details for renewal check, proceeding without renewal detection", {
            subscriptionId: subscription,
            error: stripeError instanceof Error ? stripeError.message : String(stripeError),
          });
          // Continue without renewal detection if we can't fetch subscription details
        }
      }

      logger.info("Processing invoice payment success", {
        invoiceId: stripeInvoiceId,
        customerId: customer,
        subscriptionId: subscription,
        status,
        amountPaid: amount_paid,
        currency,
        isRenewal,
      });

      // Send enhanced event to EventBridge with renewal information
      await sendEvent(
        eventBridgeClient,
        [
          {
            Source: "service.stripe",
            DetailType: "InvoicePaymentSucceeded",
            Detail: JSON.stringify({
              stripeInvoiceId,
              stripeCustomerId: customer,
              customerEmail: customerData.email,
              subscriptionId: subscription,
              status,
              amountPaid: amount_paid,
              currency,
              createdAt: created,
              isRenewal,
              renewalData,
              customerData: {
                id: customerData.id,
                email: customerData.email,
                name: customerData.name,
              },
            }),
            EventBusName: eventBusName,
          },
        ],
        logger,
      );

      logger.info("InvoicePaymentSucceeded event sent", {
        invoiceId: stripeInvoiceId
      });

      // Send email notification for subscription renewals
      if (isRenewal && customerData.email && renewalData) {
        // Get plan name from the subscription we already fetched above
        let planName = "Pro";
        try {
          const subForPlan = await stripe.subscriptions.retrieve(subscription!, {
            expand: ['items.data.price.product'],
          });
          const item = subForPlan.items.data[0];
          if (item?.price?.product && typeof item.price.product === 'object') {
            planName = (item.price.product as Stripe.Product).name || "Pro";
          }
        } catch {
          // Use default plan name if we can't fetch it
        }

        // Format amount with currency symbol
        const currencySymbols: Record<string, string> = {
          usd: "$",
          eur: "€",
          gbp: "£",
        };
        const currencySymbol = currencySymbols[currency.toLowerCase()] || currency.toUpperCase() + " ";
        const formattedAmount = (amount_paid / 100).toFixed(2);

        // Format next renewal date
        const nextRenewalDate = renewalData.currentPeriodEnd
          ? new Date(parseInt(renewalData.currentPeriodEnd) * 1000).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })
          : "your next billing cycle";

        await sendEvent(
          eventBridgeClient,
          [
            {
              Source: "service.stripe",
              DetailType: "SendSubscriptionRenewedEmail",
              Detail: JSON.stringify({
                stripeSubscriptionId: subscription,
                stripeCustomerId: customer,
                customerEmail: customerData.email,
                customerName: customerData.name || undefined,
                planName,
                amount: formattedAmount,
                currency: currencySymbol,
                nextRenewalDate,
                dashboardUrl: `https://cdkinsights.dev/dashboard`,
              }),
              EventBusName: eventBusName,
            },
          ],
          logger,
        );

        logger.info("SendSubscriptionRenewedEmail event sent", {
          invoiceId: stripeInvoiceId,
          customerId: customer,
          isRenewal: true,
        });
      }
    } catch (error) {
      logger.error("Error processing invoice payment success", {
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }; 