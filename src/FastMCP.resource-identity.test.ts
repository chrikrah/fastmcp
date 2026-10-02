import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { FastMCP } from "./FastMCP.js";

const connectInMemory = async (server: FastMCP) => {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return client;
};

const readText = async (client: Client, uri: string) =>
  (await client.readResource({ uri })).contents.map((content) =>
    "text" in content ? content.text : undefined,
  );

const listedUris = async (client: Client) =>
  (await client.listResources()).resources.map((resource) => resource.uri);

const listedUriTemplates = async (client: Client) =>
  (await client.listResourceTemplates()).resourceTemplates.map(
    (template) => template.uriTemplate,
  );

const readme = (directory: string) => ({
  load: async () => ({ text: directory }),
  name: "README",
  uri: `file:///${directory}/README.md`,
});

const lookup = (scheme: string, name = "Lookup") => ({
  arguments: [{ name: "id" as const }],
  load: async ({ id }: { id: string }) => ({ text: `${scheme} ${id}` }),
  name,
  uriTemplate: `${scheme}://{id}`,
});

describe("resources are identified by their URI", () => {
  it("keeps two resources that share a name", async () => {
    const server = new FastMCP({ name: "Test", version: "1.0.0" });

    server.addResource(readme("alpha"));
    server.addResource(readme("beta"));

    const client = await connectInMemory(server);

    expect(await listedUris(client)).toEqual([
      "file:///alpha/README.md",
      "file:///beta/README.md",
    ]);
    expect(await readText(client, "file:///alpha/README.md")).toEqual([
      "alpha",
    ]);
    expect(await readText(client, "file:///beta/README.md")).toEqual(["beta"]);

    await client.close();
  });

  it("keeps a resource when addResources adds another with its name", async () => {
    const server = new FastMCP({ name: "Test", version: "1.0.0" });

    server.addResource(readme("alpha"));
    server.addResources([readme("beta")]);

    const client = await connectInMemory(server);

    expect(await listedUris(client)).toEqual([
      "file:///alpha/README.md",
      "file:///beta/README.md",
    ]);

    await client.close();
  });

  it("keeps both when the second is added while a client is connected", async () => {
    const server = new FastMCP({ name: "Test", version: "1.0.0" });

    server.addResource(readme("alpha"));

    const client = await connectInMemory(server);

    server.addResource(readme("beta"));

    expect(await listedUris(client)).toEqual([
      "file:///alpha/README.md",
      "file:///beta/README.md",
    ]);

    await client.close();
  });

  it("replaces a resource added again under the same URI", async () => {
    const server = new FastMCP({ name: "Test", version: "1.0.0" });

    server.addResource({ ...readme("alpha"), name: "Old" });
    server.addResource({
      ...readme("alpha"),
      load: async () => ({ text: "replaced" }),
    });

    const client = await connectInMemory(server);

    expect(
      (await client.listResources()).resources.map(({ name, uri }) => ({
        name,
        uri,
      })),
    ).toEqual([{ name: "README", uri: "file:///alpha/README.md" }]);
    expect(await readText(client, "file:///alpha/README.md")).toEqual([
      "replaced",
    ]);
    expect((await server.embedded("file:///alpha/README.md")).text).toBe(
      "replaced",
    );

    await client.close();
  });
});

describe("resource templates are identified by their URI template", () => {
  it("keeps two templates that share a name", async () => {
    const server = new FastMCP({ name: "Test", version: "1.0.0" });

    server.addResourceTemplate(lookup("orders"));
    server.addResourceTemplate(lookup("customers"));

    const client = await connectInMemory(server);

    expect(await listedUriTemplates(client)).toEqual([
      "orders://{id}",
      "customers://{id}",
    ]);
    expect(await readText(client, "orders://7")).toEqual(["orders 7"]);
    expect(await readText(client, "customers://7")).toEqual(["customers 7"]);

    await client.close();
  });

  it("keeps templates that share a name across addResourceTemplates", async () => {
    const server = new FastMCP({ name: "Test", version: "1.0.0" });

    server.addResourceTemplate(lookup("orders"));
    server.addResourceTemplates([lookup("customers"), lookup("invoices")]);

    const client = await connectInMemory(server);

    expect(await listedUriTemplates(client)).toEqual([
      "orders://{id}",
      "customers://{id}",
      "invoices://{id}",
    ]);

    await client.close();
  });

  it("replaces a template added again under the same URI template", async () => {
    const server = new FastMCP({ name: "Test", version: "1.0.0" });

    server.addResourceTemplate(lookup("orders", "Old"));
    server.addResourceTemplate({
      ...lookup("orders"),
      load: async ({ id }: { id: string }) => ({ text: `replaced ${id}` }),
    });

    const client = await connectInMemory(server);

    expect(
      (await client.listResourceTemplates()).resourceTemplates.map(
        ({ name, uriTemplate }) => ({ name, uriTemplate }),
      ),
    ).toEqual([{ name: "Lookup", uriTemplate: "orders://{id}" }]);
    expect(await readText(client, "orders://7")).toEqual(["replaced 7"]);
    expect((await server.embedded("orders://7")).text).toBe("replaced 7");

    await client.close();
  });
});
