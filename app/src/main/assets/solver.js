import { dotnet } from "./runtime/dotnet.js";

async function startRuntime() {
  const runtime = await dotnet
    .withConfigSrc(new URL("./runtime/blazor.boot.json", import.meta.url).href)
    .withResourceLoader(
      (type, name) => new URL("./runtime/" + name, import.meta.url).href,
    )
    .create();
  const assembly = await runtime.getAssemblyExports("TabletEngine.dll");
  const engine = assembly.TabletEngine;
  const names = [
    "operators",
    "custom_operators",
    "operator_profiles",
    "custom_operator_profiles",
    "covenants",
    "covenant_effects",
    "garrison_maps",
  ];
  const files = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => {
        const response = await fetch("./rules/" + name + ".json");
        if (!response.ok) throw Error("无法加载 " + name);
        return [name, await response.text()];
      }),
    ),
  );
  await engine.Initialize(JSON.stringify(files));
  return engine;
}
let ready;
self.onmessage = async ({ data }) => {
  try {
    ready ||= startRuntime();
    const engine = await ready;
    const value = JSON.parse(engine.Run(data.action, JSON.stringify(data.req)));
    self.postMessage({ id: data.id, value });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error.message || error) });
  }
};
