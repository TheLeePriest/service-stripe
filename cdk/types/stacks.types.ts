import type { StackProps } from "aws-cdk-lib";

export type StripeStackProps = StackProps & {
	stage: string;
	targetEventBusName: string;
};
