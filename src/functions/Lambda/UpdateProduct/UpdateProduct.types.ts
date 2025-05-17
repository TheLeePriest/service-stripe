import type {
	UpdateItemCommand,
	UpdateItemCommandOutput,
} from "@aws-sdk/client-dynamodb";
import type Stripe from "stripe";

export type UpdateProductProductDependencies = {
	dynamoDBClient: {
		send: (command: UpdateItemCommand) => Promise<UpdateItemCommandOutput>;
	};
	stripe: Stripe;
	productsTableName: string;
};
