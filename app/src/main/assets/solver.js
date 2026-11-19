import { dotnet } from "./runtime/dotnet.js";

async function startRuntime() {
  const runtimePromise = dotnet
    .withConfigSrc(new URL("./runtime/blazor.boot.json", import.meta.url).href)
    .withResourceLoader(
      (type, name) => new URL("./runtime/" + name, import.meta.url).href,
    )
    .create();
  const names = [
    "operators",
    "custom_operators",
    "operator_profiles",
    "custom_operator_profiles",
    "covenants",
    "covenant_effects",
    "garrison_maps",
  ];
  const [runtime, entries] = await Promise.all([
    runtimePromise, Promise.all(
      names.map(async (name) => {
        const response = await fetch("./rules/" + name + ".json");
        if (!response.ok) throw Error("无法加载 " + name);
        return [name, await response.text()];
      }),
    ),
  ]);
  const assembly = await runtime.getAssemblyExports("TabletEngine.dll");
  const engine = assembly.TabletEngine;
  await engine.Initialize(JSON.stringify(Object.fromEntries(entries)));
  return engine;
}
let ready, running;
self.hongxuePlacementProgress = (step, total) =>
  self.postMessage({ id: running, progress: [step, total] });
self.onmessage = async ({ data }) => {
  try {
    ready ||= startRuntime().catch((error) => {
      ready = undefined;
      throw error;
    });
    const engine = await ready;
    running = data.id;
    const value = data.action === "warmup" ? true : JSON.parse(engine.Run(data.action, JSON.stringify(data.req)));
    self.postMessage({ id: data.id, value });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error.message || error) });
  }
};
