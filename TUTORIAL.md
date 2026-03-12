---
title: "Build a GoogleSlides agent with LangChain (TypeScript) and Arcade"
slug: "ts-langchain-GoogleSlides"
framework: "langchain-ts"
language: "typescript"
toolkits: ["GoogleSlides"]
tools: []
difficulty: "beginner"
generated_at: "2026-03-12T01:34:53Z"
source_template: "ts_langchain"
agent_repo: ""
tags:
  - "langchain"
  - "typescript"
  - "googleslides"
---

# Build a GoogleSlides agent with LangChain (TypeScript) and Arcade

In this tutorial you'll build an AI agent using [LangChain](https://js.langchain.com/) with [LangGraph](https://langchain-ai.github.io/langgraphjs/) in TypeScript and [Arcade](https://arcade.dev) that can interact with GoogleSlides tools — with built-in authorization and human-in-the-loop support.

## Prerequisites

- The [Bun](https://bun.com) runtime
- An [Arcade](https://arcade.dev) account and API key
- An OpenAI API key

## Project Setup

First, create a directory for this project, and install all the required dependencies:

````bash
mkdir googleslides-agent && cd googleslides-agent
bun install @arcadeai/arcadejs @langchain/langgraph @langchain/core langchain chalk
````

## Start the agent script

Create a `main.ts` script, and import all the packages and libraries. Imports from 
the `"./tools"` package may give errors in your IDE now, but don't worry about those
for now, you will write that helper package later.

````typescript
"use strict";
import { getTools, confirm, arcade } from "./tools";
import { createAgent } from "langchain";
import {
  Command,
  MemorySaver,
  type Interrupt,
} from "@langchain/langgraph";
import chalk from "chalk";
import * as readline from "node:readline/promises";
````

## Configuration

In `main.ts`, configure your agent's toolkits, system prompt, and model. Notice
how the system prompt tells the agent how to navigate different scenarios and
how to combine tool usage in specific ways. This prompt engineering is important
to build effective agents. In fact, the more agentic your application, the more
relevant the system prompt to truly make the agent useful and effective at
using the tools at its disposal.

````typescript
// configure your own values to customize your agent

// The Arcade User ID identifies who is authorizing each service.
const arcadeUserID = process.env.ARCADE_USER_ID;
if (!arcadeUserID) {
  throw new Error("Missing ARCADE_USER_ID. Add it to your .env file.");
}
// This determines which MCP server is providing the tools, you can customize this to make a Slack agent, or Notion agent, etc.
// all tools from each of these MCP servers will be retrieved from arcade
const toolkits=['GoogleSlides'];
// This determines isolated tools that will be
const isolatedTools=[];
// This determines the maximum number of tool definitions Arcade will return
const toolLimit = 100;
// This prompt defines the behavior of the agent.
const systemPrompt = "Below is a ready-to-use ReAct-style prompt you can give an AI agent so it can operate as an expert Google Slides assistant using the provided toolset. It describes how the agent should think, act, observe, and handle common edge cases (missing files, permissions). It also enumerates common workflows and the exact tool sequences to use.\n\nIntroduction\n------------\nYou are an AI agent that helps users create, inspect, comment on, and export Google Slides presentations. You have access to a small set of Google Slides tools (create presentations and slides, comment on slides, search the user\u0027s Drive for presentations, list presentation comments, fetch a presentation as markdown, generate a Google File Picker URL for user-driven file selection, and obtain the authenticated user\u0027s profile/permission info). Operate in a ReAct style: alternate explicit Thoughts, Actions (tool calls), Observations (tool outputs), and Final Answers. Ask clarifying questions when needed.\n\nInstructions\n------------\n- Use the ReAct format. For each step, produce:\n  - Thought: (brief reasoning about what to do next)\n  - Action: \u003cToolName\u003e\n  - Action Input: (JSON object with the tool parameters)\n  - Observation: (tool output)\n  - Repeat until you can produce a Final Answer to the user.\n- Always validate inputs before calling tools. If required information is missing (e.g., presentation title, slide index, comment text, keywords), ask the user a clarifying question.\n- Prefer searching for an existing presentation before creating a new one when the user refers to an existing file.\n- When a search or access attempt fails with \u201cfile not found\u201d or permission error, proactively propose generating a Google File Picker URL so the user can select/grant access to the correct file. Use GoogleSlides_GenerateGoogleFilePickerUrl to do this.\n- When working with slide indices: require an integer slide index. If the user gives a human ordinal (e.g., \u201csecond slide\u201d), convert it into a zero-based index only after confirming the user\u2019s expectation. If you need the number of slides, fetch the presentation with GoogleSlides_GetPresentationAsMarkdown and infer slide count from the markdown (e.g., count top-level slide headings).\n- When adding comments, ensure comment_text is natural-language and non-empty. Confirm any sensitive or destructive actions (none of the available tools delete content, but confirm before overwriting user expectations).\n- Use GoogleSlides_WhoAmI when you need to confirm your authenticated user identity, email, or permissions \u2014 do this at the start of a session if the user seems uncertain about account access.\n- If a tool returns an error or unexpected result, Thought should explain the problem and propose next steps (retry, ask user for permission, generate file picker).\n- Keep the user informed about the next action and provide clear human-readable summaries after tool actions.\n\nReAct format example (required):\n```\nThought: I should search for a presentation that matches the user\u0027s description.\nAction: GoogleSlides_SearchPresentations\nAction Input:\n{\"presentation_contains\": [\"Q1 Roadmap\"], \"limit\": 5}\nObservation: \u003ctool output\u003e\nThought: I found a presentation and need to get the text to count slides.\nAction: GoogleSlides_GetPresentationAsMarkdown\nAction Input:\n{\"presentation_id\":\"ABC123\"}\nObservation: \u003ctool output\u003e\nThought: The presentation has 6 slides; user asked to comment on slide 3 (index 2).\nAction: GoogleSlides_CommentOnPresentation\nAction Input:\n{\"presentation_id\":\"ABC123\",\"slide_index\":2,\"comment_text\":\"Great visuals \u2014 consider enlarging the axis labels.\"}\nObservation: \u003ctool output\u003e\nFinal Answer: I added the comment to slide 3. Anything else?\n```\n\nWorkflows\n---------\nBelow are common workflows and the recommended tool sequences. Follow the ReAct format when executing them.\n\n1) Create a new presentation and add slides\n- Purpose: Create a new presentation and populate first slide (title/subtitle) and optional additional slides.\n- Sequence:\n  1. GoogleSlides_CreatePresentation (title, subtitle)\n  2. For each extra slide: GoogleSlides_CreateSlide (presentation_id, slide_title, slide_body)\n- Notes: Confirm title and subtitle with the user before Action. Return the new presentation ID in the Final Answer.\n\nExample:\n```\nAction: GoogleSlides_CreatePresentation\nAction Input: {\"title\":\"Product Launch Deck\",\"subtitle\":\"Q3 2026 Launch Plan\"}\n```\n\n2) Find an existing presentation and inspect/export it\n- Purpose: Locate an existing presentation and get its text content as markdown for review, edits, or analysis.\n- Sequence:\n  1. GoogleSlides_SearchPresentations (presentation_contains = [keywords], limit = n)\n     - If zero results or permission issues: propose file picker (see step 4).\n  2. GoogleSlides_GetPresentationAsMarkdown (presentation_id)\n- Notes: Use the markdown to count slides or extract slide contents for further actions.\n\n3) Add a comment to a specific slide\n- Purpose: Add reviewer feedback to a particular slide.\n- Sequence:\n  1. If the presentation_id is unknown: GoogleSlides_SearchPresentations\n  2. Optionally: GoogleSlides_GetPresentationAsMarkdown to confirm slide index or content\n  3. GoogleSlides_CommentOnPresentation (presentation_id, slide_index, comment_text)\n- Notes: Confirm slide index with the user when ambiguous (human ordinal vs zero-based index). If you used markdown to count slides, mention the derived index to the user before commenting.\n\nExample:\n```\nAction: GoogleSlides_CommentOnPresentation\nAction Input:\n{\"presentation_id\":\"ABC123\",\"slide_index\":0,\"comment_text\":\"Please add a source for the market size figure on this slide.\"}\n```\n\n4) Handle file-not-found or permission errors (File selection flow)\n- Purpose: Guide the user to grant or select the correct file when search/access fails.\n- Sequence:\n  1. GoogleSlides_GenerateGoogleFilePickerUrl\n  2. Present the generated URL to the user and ask them to select the file and re-run the flow (or indicate which file they selected).\n- Notes: Use this when GoogleSlides_SearchPresentations returns no results or when an access permission error is suspected.\n\n5) List all comments on a presentation (include deleted if requested)\n- Purpose: Review reviewer comments for a presentation.\n- Sequence:\n  1. If needed: GoogleSlides_SearchPresentations\n  2. GoogleSlides_ListPresentationComments (presentation_id, include_deleted = true/false)\n- Notes: Ask whether to include deleted comments. Summarize comments in Final Answer, or provide the raw list if the user requests.\n\n6) Multi-step update with confirmation\n- Purpose: When a user wants multiple changes (create + add slides + comment), perform each step and confirm before proceeding to the next.\n- Sequence:\n  1. GoogleSlides_CreatePresentation (title, subtitle) OR GoogleSlides_SearchPresentations (if editing an existing file)\n  2. GoogleSlides_CreateSlide (repeat as needed)\n  3. GoogleSlides_CommentOnPresentation (as needed)\n  4. Final: GoogleSlides_GetPresentationAsMarkdown (optional) to show a summary\n- Notes: After each major action, provide a brief summary and ask if the user wants to continue.\n\n7) Check authenticated user / environment\n- Purpose: Confirm the agent is using the correct Google account and what permissions are available.\n- Sequence:\n  1. GoogleSlides_WhoAmI\n- Notes: Use at session start if the user is uncertain which account is active.\n\nError handling and edge cases\n-----------------------------\n- If a tool returns an error message referencing \u201cRequested entity was not found\u201d or \u201cPermission denied,\u201d Thought should note the error and then Action should be GoogleSlides_GenerateGoogleFilePickerUrl to let the user select the file. Wait for the user to respond with the selected file or to re-run the search.\n- If a required parameter is missing (e.g., slide_index, presentation_id, comment_text), ask the user for it rather than guessing.\n- If a numeric slide index is out of range according to the markdown-derived slide count, ask the user to confirm which slide they mean.\n- Keep replies concise but informative. After tool-based changes, always state the result and next recommended steps.\n\nHelpful tips for the agent\n--------------------------\n- Always surface the presentation_id in your Final Answer when creating or selecting a file so the user can reference it in future requests.\n- When searching, provide up to 5\u201310 results and ask the user to pick one if multiple close matches are found.\n- When summarizing comments or slide content, use short bullet lists and cite slide numbers (1-based for user-facing numbering) in the Final Answer.\n- Use plain language for user-facing messages; reserve technical detail for Thoughts/Action Inputs.\n\nReady-to-use ReAct template\n--------------------------\n```\nThought: \u003cyour reasoning\u003e\nAction: \u003cToolName\u003e\nAction Input:\n{ ... }\nObservation: \u003ctool output\u003e\n... (repeat)\nFinal Answer: \u003cclear human-facing summary and next steps\u003e\n```\n\nUse this prompt to guide the agent\u2019s decisions, tool use, error recovery, and user interactions.";
// This determines which LLM will be used inside the agent
const agentModel = process.env.OPENAI_MODEL;
if (!agentModel) {
  throw new Error("Missing OPENAI_MODEL. Add it to your .env file.");
}
// This allows LangChain to retain the context of the session
const threadID = "1";
````

Set the following environment variables in a `.env` file:

````bash
ARCADE_API_KEY=your-arcade-api-key
ARCADE_USER_ID=your-arcade-user-id
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-5-mini
````

## Implementing the `tools.ts` module

The `tools.ts` module fetches Arcade tool definitions and converts them to LangChain-compatible tools using Arcade's Zod schema conversion:

### Create the file and import the dependencies

Create a `tools.ts` file, and add import the following. These will allow you to build the helper functions needed to convert Arcade tool definitions into a format that LangChain can execute. Here, you also define which tools will require human-in-the-loop confirmation. This is very useful for tools that may have dangerous or undesired side-effects if the LLM hallucinates the values in the parameters. You will implement the helper functions to require human approval in this module.

````typescript
import { Arcade } from "@arcadeai/arcadejs";
import {
  type ToolExecuteFunctionFactoryInput,
  type ZodTool,
  executeZodTool,
  isAuthorizationRequiredError,
  toZod,
} from "@arcadeai/arcadejs/lib/index";
import { type ToolExecuteFunction } from "@arcadeai/arcadejs/lib/zod/types";
import { tool } from "langchain";
import {
  interrupt,
} from "@langchain/langgraph";
import readline from "node:readline/promises";

// This determines which tools require human in the loop approval to run
const TOOLS_WITH_APPROVAL = ['GoogleSlides_CommentOnPresentation', 'GoogleSlides_CreatePresentation', 'GoogleSlides_CreateSlide'];
````

### Create a confirmation helper for human in the loop

The first helper that you will write is the `confirm` function, which asks a yes or no question to the user, and returns `true` if theuser replied with `"yes"` and `false` otherwise.

````typescript
// Prompt user for yes/no confirmation
export async function confirm(question: string, rl?: readline.Interface): Promise<boolean> {
  let shouldClose = false;
  let interface_ = rl;

  if (!interface_) {
      interface_ = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
      });
      shouldClose = true;
  }

  const answer = await interface_.question(`${question} (y/n): `);

  if (shouldClose) {
      interface_.close();
  }

  return ["y", "yes"].includes(answer.trim().toLowerCase());
}
````

Tools that require authorization trigger a LangGraph interrupt, which pauses execution until the user completes authorization in their browser.

### Create the execution helper

This is a wrapper around the `executeZodTool` function. Before you execute the tool, however, there are two logical checks to be made:

1. First, if the tool the agent wants to invoke is included in the `TOOLS_WITH_APPROVAL` variable, human-in-the-loop is enforced by calling `interrupt` and passing the necessary data to call the `confirm` helper. LangChain will surface that `interrupt` to the agentic loop, and you will be required to "resolve" the interrupt later on. For now, you can assume that the reponse of the `interrupt` will have enough information to decide whether to execute the tool or not, depending on the human's reponse.
2. Second, if the tool was approved by the human, but it doesn't have the authorization of the integration to run, then you need to present an URL to the user so they can authorize the OAuth flow for this operation. For this, an execution is attempted, that may fail to run if the user is not authorized. When it fails, you interrupt the flow and send the authorization request for the harness to handle. If the user authorizes the tool, the harness will reply with an `{authorized: true}` object, and the system will retry the tool call without interrupting the flow.

````typescript
export function executeOrInterruptTool({
  zodToolSchema,
  toolDefinition,
  client,
  userId,
}: ToolExecuteFunctionFactoryInput): ToolExecuteFunction<any> {
  const { name: toolName } = zodToolSchema;

  return async (input: unknown) => {
    try {

      // If the tool is on the list that enforces human in the loop, we interrupt the flow and ask the user to authorize the tool

      if (TOOLS_WITH_APPROVAL.includes(toolName)) {
        const hitl_response = interrupt({
          authorization_required: false,
          hitl_required: true,
          tool_name: toolName,
          input: input,
        });

        if (!hitl_response.authorized) {
          // If the user didn't approve the tool call, we throw an error, which will be handled by LangChain
          throw new Error(
            `Human in the loop required for tool call ${toolName}, but user didn't approve.`
          );
        }
      }

      // Try to execute the tool
      const result = await executeZodTool({
        zodToolSchema,
        toolDefinition,
        client,
        userId,
      })(input);
      return result;
    } catch (error) {
      // If the tool requires authorization, we interrupt the flow and ask the user to authorize the tool
      if (error instanceof Error && isAuthorizationRequiredError(error)) {
        const response = await client.tools.authorize({
          tool_name: toolName,
          user_id: userId,
        });

        // We interrupt the flow here, and pass everything the handler needs to get the user's authorization
        const interrupt_response = interrupt({
          authorization_required: true,
          authorization_response: response,
          tool_name: toolName,
          url: response.url ?? "",
        });

        // If the user authorized the tool, we retry the tool call without interrupting the flow
        if (interrupt_response.authorized) {
          const result = await executeZodTool({
            zodToolSchema,
            toolDefinition,
            client,
            userId,
          })(input);
          return result;
        } else {
          // If the user didn't authorize the tool, we throw an error, which will be handled by LangChain
          throw new Error(
            `Authorization required for tool call ${toolName}, but user didn't authorize.`
          );
        }
      }
      throw error;
    }
  };
}
````

### Create the tool retrieval helper

The last helper function of this module is the `getTools` helper. This function will take the configurations you defined in the `main.ts` file, and retrieve all of the configured tool definitions from Arcade. Those definitions will then be converted to LangGraph `Function` tools, and will be returned in a format that LangChain can present to the LLM so it can use the tools and pass the arguments correctly. You will pass the `executeOrInterruptTool` helper you wrote in the previous section so all the bindings to the human-in-the-loop and auth handling are programmed when LancChain invokes a tool.


````typescript
// Initialize the Arcade client
export const arcade = new Arcade();

export type GetToolsProps = {
  arcade: Arcade;
  toolkits?: string[];
  tools?: string[];
  userId: string;
  limit?: number;
}


export async function getTools({
  arcade,
  toolkits = [],
  tools = [],
  userId,
  limit = 100,
}: GetToolsProps) {

  if (toolkits.length === 0 && tools.length === 0) {
      throw new Error("At least one tool or toolkit must be provided");
  }

  // Todo(Mateo): Add pagination support
  const from_toolkits = await Promise.all(toolkits.map(async (tkitName) => {
      const definitions = await arcade.tools.list({
          toolkit: tkitName,
          limit: limit
      });
      return definitions.items;
  }));

  const from_tools = await Promise.all(tools.map(async (toolName) => {
      return await arcade.tools.get(toolName);
  }));

  const all_tools = [...from_toolkits.flat(), ...from_tools];
  const unique_tools = Array.from(
      new Map(all_tools.map(tool => [tool.qualified_name, tool])).values()
  );

  const arcadeTools = toZod({
    tools: unique_tools,
    client: arcade,
    executeFactory: executeOrInterruptTool,
    userId: userId,
  });

  // Convert Arcade tools to LangGraph tools
  const langchainTools = arcadeTools.map(({ name, description, execute, parameters }) =>
    (tool as Function)(execute, {
      name,
      description,
      schema: parameters,
    })
  );

  return langchainTools;
}
````

## Building the Agent

Back on the `main.ts` file, you can now call the helper functions you wrote to build the agent.

### Retrieve the configured tools

Use the `getTools` helper you wrote to retrieve the tools from Arcade in LangChain format:

````typescript
const tools = await getTools({
  arcade,
  toolkits: toolkits,
  tools: isolatedTools,
  userId: arcadeUserID,
  limit: toolLimit,
});
````

### Write an interrupt handler

When LangChain is interrupted, it will emit an event in the stream that you will need to handle and resolve based on the user's behavior. For a human-in-the-loop interrupt, you will call the `confirm` helper you wrote earlier, and indicate to the harness whether the human approved the specific tool call or not. For an auth interrupt, you will present the OAuth URL to the user, and wait for them to finishe the OAuth dance before resolving the interrupt with `{authorized: true}` or `{authorized: false}` if an error occurred:

````typescript
async function handleInterrupt(
  interrupt: Interrupt,
  rl: readline.Interface
): Promise<{ authorized: boolean }> {
  const value = interrupt.value;
  const authorization_required = value.authorization_required;
  const hitl_required = value.hitl_required;
  if (authorization_required) {
    const tool_name = value.tool_name;
    const authorization_response = value.authorization_response;
    console.log("⚙️: Authorization required for tool call", tool_name);
    console.log(
      "⚙️: Please authorize in your browser",
      authorization_response.url
    );
    console.log("⚙️: Waiting for you to complete authorization...");
    try {
      await arcade.auth.waitForCompletion(authorization_response.id);
      console.log("⚙️: Authorization granted. Resuming execution...");
      return { authorized: true };
    } catch (error) {
      console.error("⚙️: Error waiting for authorization to complete:", error);
      return { authorized: false };
    }
  } else if (hitl_required) {
    console.log("⚙️: Human in the loop required for tool call", value.tool_name);
    console.log("⚙️: Please approve the tool call", value.input);
    const approved = await confirm("Do you approve this tool call?", rl);
    return { authorized: approved };
  }
  return { authorized: false };
}
````

### Create an Agent instance

Here you create the agent using the `createAgent` function. You pass the system prompt, the model, the tools, and the checkpointer. When the agent runs, it will automatically use the helper function you wrote earlier to handle tool calls and authorization requests.

````typescript
const agent = createAgent({
  systemPrompt: systemPrompt,
  model: agentModel,
  tools: tools,
  checkpointer: new MemorySaver(),
});
````

### Write the invoke helper

This last helper function handles the streaming of the agent’s response, and captures the interrupts. When the system detects an interrupt, it adds the interrupt to the `interrupts` array, and the flow interrupts. If there are no interrupts, it will just stream the agent’s to your console.

````typescript
async function streamAgent(
  agent: any,
  input: any,
  config: any
): Promise<Interrupt[]> {
  const stream = await agent.stream(input, {
    ...config,
    streamMode: "updates",
  });
  const interrupts: Interrupt[] = [];

  for await (const chunk of stream) {
    if (chunk.__interrupt__) {
      interrupts.push(...(chunk.__interrupt__ as Interrupt[]));
      continue;
    }
    for (const update of Object.values(chunk)) {
      for (const msg of (update as any)?.messages ?? []) {
        console.log("🤖: ", msg.toFormattedString());
      }
    }
  }

  return interrupts;
}
````

### Write the main function

Finally, write the main function that will call the agent and handle the user input.

Here the `config` object configures the `thread_id`, which tells the agent to store the state of the conversation into that specific thread. Like any typical agent loop, you:

1. Capture the user input
2. Stream the agent's response
3. Handle any authorization interrupts
4. Resume the agent after authorization
5. Handle any errors
6. Exit the loop if the user wants to quit

````typescript
async function main() {
  const config = { configurable: { thread_id: threadID } };
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.green("Welcome to the chatbot! Type 'exit' to quit."));
  while (true) {
    const input = await rl.question("> ");
    if (input.toLowerCase() === "exit") {
      break;
    }
    rl.pause();

    try {
      let agentInput: any = {
        messages: [{ role: "user", content: input }],
      };

      // Loop until no more interrupts
      while (true) {
        const interrupts = await streamAgent(agent, agentInput, config);

        if (interrupts.length === 0) {
          break; // No more interrupts, we're done
        }

        // Handle all interrupts
        const decisions: any[] = [];
        for (const interrupt of interrupts) {
          decisions.push(await handleInterrupt(interrupt, rl));
        }

        // Resume with decisions, then loop to check for more interrupts
        // Pass single decision directly, or array for multiple interrupts
        agentInput = new Command({ resume: decisions.length === 1 ? decisions[0] : decisions });
      }
    } catch (error) {
      console.error(error);
    }

    rl.resume();
  }
  console.log(chalk.red("👋 Bye..."));
  process.exit(0);
}

// Run the main function
main().catch((err) => console.error(err));
````

## Running the Agent

### Run the agent

```bash
bun run main.ts
```

You should see the agent responding to your prompts like any model, as well as handling any tool calls and authorization requests.

## Next Steps

- Clone the [repository](https://github.com/arcade-agents/ts-langchain-GoogleSlides) and run it
- Add more toolkits to the `toolkits` array to expand capabilities
- Customize the `systemPrompt` to specialize the agent's behavior
- Explore the [Arcade documentation](https://docs.arcade.dev) for available toolkits

