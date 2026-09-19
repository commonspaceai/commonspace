export const enum SettingsOperationStatus {
	Idle = "idle",
	Running = "running",
	Succeeded = "succeeded",
	Failed = "failed",
}

interface IdleSettingsOperation {
	status: SettingsOperationStatus.Idle;
}
interface RunningSettingsOperation {
	status: SettingsOperationStatus.Running;
	message: string;
}
interface SuccessfulSettingsOperation {
	status: SettingsOperationStatus.Succeeded;
	message: string;
}
interface FailedSettingsOperation {
	status: SettingsOperationStatus.Failed;
	message: string;
}

export type SettingsOperation =
	| IdleSettingsOperation
	| RunningSettingsOperation
	| SuccessfulSettingsOperation
	| FailedSettingsOperation;
