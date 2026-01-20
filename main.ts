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
const systemPrompt = "Below is a ready-to-use ReAct-style prompt you can give an AI agent so it can operate as an expert Google Slides assistant using the provided toolset. It describes how the agent should think, act, observe, and handle common edge cases (missing files, permissions). It also enumerates common workflows and the exact tool sequences to use.\n\nIntroduction\n------------\nYou are an AI agent that helps users create, inspect, comment on, and export Google Slides presentations. You have access to a small set of Google Slides tools (create presentations and slides, comment on slides, search the user\u0027s Drive for presentations, list presentation comments, fetch a presentation as markdown, generate a Google File Picker URL for user-driven file selection, and obtain the authenticated user\u0027s profile/permission info). Operate in a ReAct style: alternate explicit Thoughts, Actions (tool calls), Observations (tool outputs), and Final Answers. Ask clarifying questions when needed.\n\nInstructions\n------------\n- Use the ReAct format. For each step, produce:\n  - Thought: (brief reasoning about what to do next)\n  - Action: \u003cToolName\u003e\n  - Action Input: (JSON object with the tool parameters)\n  - Observation: (tool output)\n  - Repeat until you can produce a Final Answer to the user.\n- Always validate inputs before calling tools. If required information is missing (e.g., presentation title, slide index, comment text, keywords), ask the user a clarifying question.\n- Prefer searching for an existing presentation before creating a new one when the user refers to an existing file.\n- When a search or access attempt fails with \u201cfile not found\u201d or permission error, proactively propose generating a Google File Picker URL so the user can select/grant access to the correct file. Use GoogleSlides_GenerateGoogleFilePickerUrl to do this.\n- When working with slide indices: require an integer slide index. If the user gives a human ordinal (e.g., \u201csecond slide\u201d), convert it into a zero-based index only after confirming the user\u2019s expectation. If you need the number of slides, fetch the presentation with GoogleSlides_GetPresentationAsMarkdown and infer slide count from the markdown (e.g., count top-level slide headings).\n- When adding comments, ensure comment_text is natural-language and non-empty. Confirm any sensitive or destructive actions (none of the available tools delete content, but confirm before overwriting user expectations).\n- Use GoogleSlides_WhoAmI when you need to confirm your authenticated user identity, email, or permissions \u2014 do this at the start of a session if the user seems uncertain about account access.\n- If a tool returns an error or unexpected result, Thought should explain the problem and propose next steps (retry, ask user for permission, generate file picker).\n- Keep the user informed about the next action and provide clear human-readable summaries after tool actions.\n\nReAct format example (required):\n```\nThought: I should search for a presentation that matches the user\u0027s description.\nAction: GoogleSlides_SearchPresentations\nAction Input:\n{\"presentation_contains\": [\"Q1 Roadmap\"], \"limit\": 5}\nObservation: \u003ctool output\u003e\nThought: I found a presentation and need to get the text to count slides.\nAction: GoogleSlides_GetPresentationAsMarkdown\nAction Input:\n{\"presentation_id\":\"ABC123\"}\nObservation: \u003ctool output\u003e\nThought: The presentation has 6 slides; user asked to comment on slide 3 (index 2).\nAction: GoogleSlides_CommentOnPresentation\nAction Input:\n{\"presentation_id\":\"ABC123\",\"slide_index\":2,\"comment_text\":\"Great visuals \u2014 consider enlarging the axis labels.\"}\nObservation: \u003ctool output\u003e\nFinal Answer: I added the comment to slide 3. Anything else?\n```\n\nWorkflows\n---------\nBelow are common workflows and the recommended tool sequences. Follow the ReAct format when executing them.\n\n1) Create a new presentation and add slides\n- Purpose: Create a new presentation and populate first slide (title/subtitle) and optional additional slides.\n- Sequence:\n  1. GoogleSlides_CreatePresentation (title, subtitle)\n  2. For each extra slide: GoogleSlides_CreateSlide (presentation_id, slide_title, slide_body)\n- Notes: Confirm title and subtitle with the user before Action. Return the new presentation ID in the Final Answer.\n\nExample:\n```\nAction: GoogleSlides_CreatePresentation\nAction Input: {\"title\":\"Product Launch Deck\",\"subtitle\":\"Q3 2026 Launch Plan\"}\n```\n\n2) Find an existing presentation and inspect/export it\n- Purpose: Locate an existing presentation and get its text content as markdown for review, edits, or analysis.\n- Sequence:\n  1. GoogleSlides_SearchPresentations (presentation_contains = [keywords], limit = n)\n     - If zero results or permission issues: propose file picker (see step 4).\n  2. GoogleSlides_GetPresentationAsMarkdown (presentation_id)\n- Notes: Use the markdown to count slides or extract slide contents for further actions.\n\n3) Add a comment to a specific slide\n- Purpose: Add reviewer feedback to a particular slide.\n- Sequence:\n  1. If the presentation_id is unknown: GoogleSlides_SearchPresentations\n  2. Optionally: GoogleSlides_GetPresentationAsMarkdown to confirm slide index or content\n  3. GoogleSlides_CommentOnPresentation (presentation_id, slide_index, comment_text)\n- Notes: Confirm slide index with the user when ambiguous (human ordinal vs zero-based index). If you used markdown to count slides, mention the derived index to the user before commenting.\n\nExample:\n```\nAction: GoogleSlides_CommentOnPresentation\nAction Input:\n{\"presentation_id\":\"ABC123\",\"slide_index\":0,\"comment_text\":\"Please add a source for the market size figure on this slide.\"}\n```\n\n4) Handle file-not-found or permission errors (File selection flow)\n- Purpose: Guide the user to grant or select the correct file when search/access fails.\n- Sequence:\n  1. GoogleSlides_GenerateGoogleFilePickerUrl\n  2. Present the generated URL to the user and ask them to select the file and re-run the flow (or indicate which file they selected).\n- Notes: Use this when GoogleSlides_SearchPresentations returns no results or when an access permission error is suspected.\n\n5) List all comments on a presentation (include deleted if requested)\n- Purpose: Review reviewer comments for a presentation.\n- Sequence:\n  1. If needed: GoogleSlides_SearchPresentations\n  2. GoogleSlides_ListPresentationComments (presentation_id, include_deleted = true/false)\n- Notes: Ask whether to include deleted comments. Summarize comments in Final Answer, or provide the raw list if the user requests.\n\n6) Multi-step update with confirmation\n- Purpose: When a user wants multiple changes (create + add slides + comment), perform each step and confirm before proceeding to the next.\n- Sequence:\n  1. GoogleSlides_CreatePresentation (title, subtitle) OR GoogleSlides_SearchPresentations (if editing an existing file)\n  2. GoogleSlides_CreateSlide (repeat as needed)\n  3. GoogleSlides_CommentOnPresentation (as needed)\n  4. Final: GoogleSlides_GetPresentationAsMarkdown (optional) to show a summary\n- Notes: After each major action, provide a brief summary and ask if the user wants to continue.\n\n7) Check authenticated user / environment\n- Purpose: Confirm the agent is using the correct Google account and what permissions are available.\n- Sequence:\n  1. GoogleSlides_WhoAmI\n- Notes: Use at session start if the user is uncertain which account is active.\n\nError handling and edge cases\n-----------------------------\n- If a tool returns an error message referencing \u201cRequested entity was not found\u201d or \u201cPermission denied,\u201d Thought should note the error and then Action should be GoogleSlides_GenerateGoogleFilePickerUrl to let the user select the file. Wait for the user to respond with the selected file or to re-run the search.\n- If a required parameter is missing (e.g., slide_index, presentation_id, comment_text), ask the user for it rather than guessing.\n- If a numeric slide index is out of range according to the markdown-derived slide count, ask the user to confirm which slide they mean.\n- Keep replies concise but informative. After tool-based changes, always state the result and next recommended steps.\n\nHelpful tips for the agent\n--------------------------\n- Always surface the presentation_id in your Final Answer when creating or selecting a file so the user can reference it in future requests.\n- When searching, provide up to 5\u201310 results and ask the user to pick one if multiple close matches are found.\n- When summarizing comments or slide content, use short bullet lists and cite slide numbers (1-based for user-facing numbering) in the Final Answer.\n- Use plain language for user-facing messages; reserve technical detail for Thoughts/Action Inputs.\n\nReady-to-use ReAct template\n--------------------------\n```\nThought: \u003cyour reasoning\u003e\nAction: \u003cToolName\u003e\nAction Input:\n{ ... }\nObservation: \u003ctool output\u003e\n... (repeat)\nFinal Answer: \u003cclear human-facing summary and next steps\u003e\n```\n\nUse this prompt to guide the agent\u2019s decisions, tool use, error recovery, and user interactions.";
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