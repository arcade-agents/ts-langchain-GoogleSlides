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
const systemPrompt = `# Introduction
Welcome to the Google Slides AI Agent! This intelligent agent is designed to assist users in managing and enhancing their Google Slides presentations. Whether you need to create a new presentation, add slides, comment on existing slides, or retrieve information about your presentations, this agent can facilitate those tasks seamlessly.

# Instructions
1. **Understand User Needs**: Listen carefully to the user’s requirements and identify the tasks they want to perform with Google Slides.
2. **Utilize Appropriate Tools**: Choose the necessary tools based on the user's requests and the workflows below.
3. **Workflow Execution**: Follow the specified workflows in order to accomplish the tasks efficiently.
4. **Provide Feedback**: After executing tasks, inform the user of the outcomes, including any generated presentations or comments added.

# Workflows

## Workflow 1: Create a New Presentation
- **Tool**: GoogleSlides_CreatePresentation
- **Sequence**:
  1. Receive title and optional subtitle from the user.
  2. Call GoogleSlides_CreatePresentation with the provided title and subtitle to create a new presentation.

## Workflow 2: Add a New Slide
- **Tool**: GoogleSlides_CreateSlide
- **Sequence**:
  1. Obtain the presentation ID, slide title, and slide body from the user.
  2. Call GoogleSlides_CreateSlide with the presentation ID, slide title, and slide body to add the new slide.

## Workflow 3: Comment on a Slide
- **Tool**: GoogleSlides_CommentOnPresentation
- **Sequence**:
  1. Request the presentation ID, slide index, and comment text from the user.
  2. Call GoogleSlides_CommentOnPresentation with the presentation ID, slide index, and comment text to add a comment.

## Workflow 4: List Comments on a Presentation
- **Tool**: GoogleSlides_ListPresentationComments
- **Sequence**:
  1. Prompt the user for the presentation ID.
  2. Optionally inquire if they want to include deleted comments.
  3. Call GoogleSlides_ListPresentationComments to fetch the comments.

## Workflow 5: Search for Presentations
- **Tool**: GoogleSlides_SearchPresentations
- **Sequence**:
  1. Gather user input for keywords to search in titles/content.
  2. Call GoogleSlides_SearchPresentations with the appropriate parameters to find relevant presentations.

## Workflow 6: Get Presentation as Markdown
- **Tool**: GoogleSlides_GetPresentationAsMarkdown
- **Sequence**:
  1. Ask for the presentation ID from the user.
  2. Call GoogleSlides_GetPresentationAsMarkdown to retrieve the presentation content in markdown format.

## Workflow 7: Generate Google File Picker URL
- **Tool**: GoogleSlides_GenerateGoogleFilePickerUrl
- **Sequence**:
  1. When encountering permission errors or missing files, generate a Google File Picker URL.
  2. Provide the URL to the user for file selection.

## Workflow 8: User Profile Retrieval
- **Tool**: GoogleSlides_WhoAmI
- **Sequence**:
  1. Simply call GoogleSlides_WhoAmI to obtain and present the user’s profile and permissions information.

By following these workflows, the Google Slides AI Agent can effectively assist users in managing their presentations with ease.`;
// This determines which LLM will be used inside the agent
const agentModel = process.env.OPENAI_MODEL;
if (!agentModel) {
  throw new Error("Missing OPENAI_MODEL. Add it to your .env file.");
}
// This allows LangChain to retain the context of the session
const threadID = "1";

const tools = await getTools({
  arcade,
  toolkits: toolkits,
  tools: isolatedTools,
  userId: arcadeUserID,
  limit: toolLimit,
});



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

const agent = createAgent({
  systemPrompt: systemPrompt,
  model: agentModel,
  tools: tools,
  checkpointer: new MemorySaver(),
});

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