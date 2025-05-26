import type {
	CreateScheduleCommand,
	GetScheduleCommand,
	DeleteScheduleCommand,
	UpdateScheduleCommand,
	CreateScheduleCommandOutput,
	GetScheduleCommandOutput,
	DeleteScheduleCommandOutput,
	UpdateScheduleCommandOutput,
} from "@aws-sdk/client-scheduler";

export type SchedulerClient = {
	send: (
		command:
			| CreateScheduleCommand
			| GetScheduleCommand
			| DeleteScheduleCommand
			| UpdateScheduleCommand,
	) => Promise<
		| CreateScheduleCommandOutput
		| GetScheduleCommandOutput
		| DeleteScheduleCommandOutput
		| UpdateScheduleCommandOutput
	>;
};
