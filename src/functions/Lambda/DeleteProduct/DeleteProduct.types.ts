import type {
	CreateUsagePlanCommand,
	CreateUsagePlanCommandOutput,
	DeleteUsagePlanCommand,
	DeleteUsagePlanCommandOutput,
	GetUsagePlansCommand,
	GetUsagePlansCommandOutput,
} from "@aws-sdk/client-api-gateway";
import type {
	DeleteItemCommand,
	DeleteItemCommandOutput,
	QueryCommand,
	QueryCommandOutput,
	UpdateItemCommand,
	UpdateItemCommandOutput,
} from "@aws-sdk/client-dynamodb";
import type Stripe from "stripe";
import type { Logger } from "../types/utils.types";

export type DeleteProductDependencies = {
	stage: string;
	dynamoDBClient: {
		send: (
			command: UpdateItemCommand | DeleteItemCommand | QueryCommand,
		) => Promise<
			UpdateItemCommandOutput | DeleteItemCommandOutput | QueryCommandOutput
		>;
	};
	apiGatewayClient: {
		send: (
			command:
				| CreateUsagePlanCommand
				| GetUsagePlansCommand
				| DeleteUsagePlanCommand,
		) => Promise<
			| CreateUsagePlanCommandOutput
			| GetUsagePlansCommandOutput
			| DeleteUsagePlanCommandOutput
		>;
	};
	stripe: Stripe;
	apiId: string;
	productsTableName: string;
	logger: Logger;
};
