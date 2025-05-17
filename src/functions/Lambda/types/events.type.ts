import type Stripe from "stripe";

export type StripeEventBridgeEvent<E extends Stripe.Event> = {
	version: string;
	id: string;
	"detail-type": E["type"];
	source: "aws.partner/stripe.com";
	account: string;
	time: string;
	region: string;
	resources: string[];
	detail: E;
};

export type CheckoutSessionCompleted = Stripe.Event & {
	type: "checkout.session.completed";
};

export type PriceCreated = Stripe.Event & {
	type: "price.created";
};

export type PriceDeleted = Stripe.Event & {
	type: "price.deleted";
};

export type PriceUpdated = Stripe.Event & {
	type: "price.updated";
};

export type SubscriptionCreated = Stripe.Event & {
	type: "customer.subscription.created";
};

export type SubscriptionUpdated = Stripe.Event & {
	type: "customer.subscription.updated";
};

export type SubscriptionDeleted = Stripe.Event & {
	type: "customer.subscription.deleted";
};

export type SubscriptionCancelled = Stripe.Event & {
	type: "customer.subscription.updated" | "customer.subscription.deleted";
};
