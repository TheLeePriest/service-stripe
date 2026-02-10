import Stripe from "stripe";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const STRIPE_API_VERSION = "2025-04-30.basil";
let cachedClient: Stripe | undefined;
const ssmClient = new SSMClient({});

export async function getStripeClient(stage: string): Promise<Stripe> {
  if (cachedClient) return cachedClient;

  const result = await ssmClient.send(
    new GetParameterCommand({
      Name: `/${stage}/stripe/secret`,
      WithDecryption: true,
    }),
  );

  if (!result.Parameter?.Value) {
    throw new Error("Stripe secret not found in SSM");
  }

  cachedClient = new Stripe(result.Parameter.Value, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
  });

  return cachedClient;
}
