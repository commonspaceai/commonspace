import { useEffect, useState } from "react";
import { CommonspaceApp } from "../CommonspaceApp";
import { CommonspaceClientStore } from "../commonspace-store";

/** Production components and store; MSW supplies this story's disposable API. */
export function WorkspaceStory({
	initialPath = "/channels/channel-design/threads/thread-review",
}: {
	initialPath?: string;
}) {
	const [store] = useState(() => {
		const client = new CommonspaceClientStore();
		// The HTTP mock returns complete snapshots; there is no native event stream.
		client.connectEvents = () => undefined;
		client.disconnectEvents = () => undefined;
		return client;
	});
	useEffect(() => {
		void store.refresh();
	}, [store]);
	return <CommonspaceApp store={store} initialPath={initialPath} />;
}
