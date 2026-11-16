const canonicalTaskInstance = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

// A bearer is deliberately not accepted as a parameter here: the caller must
// supply it to the spawned CLI via the separate stdin pipe.
export function checkoutRemoteArgs(origin: string, taskInstanceID: string, workspaceRoot: string): string[] {
  if (!canonicalTaskInstance.test(taskInstanceID)) {
    throw new Error("Нужен UUID TaskInstance.");
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("Укажи HTTPS origin Codechuman Gateway.");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") {
    throw new Error("Codechuman Gateway должен быть HTTPS origin без пути и учётных данных.");
  }
  return ["checkout-remote", "--api-base", url.origin, "--task-instance", taskInstanceID,
    "--root", workspaceRoot, "--token-stdin"];
}

export function openRemoteArgs(origin:string,task:string,root:string):string[]{
 const args=checkoutRemoteArgs(origin,task,root);args[0]='open-remote';return args;
}
