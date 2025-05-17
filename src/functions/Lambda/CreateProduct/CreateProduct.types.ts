import type {
	PutItemCommand,
	PutItemCommandOutput,
} from "@aws-sdk/client-dynamodb";
import type Stripe from "stripe";

export type CreateProductDependencies = {
	dynamoDBClient: {
		send: (command: PutItemCommand) => Promise<PutItemCommandOutput>;
	};
	stripe: Stripe;
	productsTableName: string;
};
