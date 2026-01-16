from agents import (Agent, Runner, AgentHooks, Tool, RunContextWrapper,
                    TResponseInputItem,)
from functools import partial
from arcadepy import AsyncArcade
from agents_arcade import get_arcade_tools
from typing import Any
from human_in_the_loop import (UserDeniedToolCall,
                               confirm_tool_usage,
                               auth_tool)

import globals


class CustomAgentHooks(AgentHooks):
    def __init__(self, display_name: str):
        self.event_counter = 0
        self.display_name = display_name

    async def on_start(self,
                       context: RunContextWrapper,
                       agent: Agent) -> None:
        self.event_counter += 1
        print(f"### ({self.display_name}) {
              self.event_counter}: Agent {agent.name} started")

    async def on_end(self,
                     context: RunContextWrapper,
                     agent: Agent,
                     output: Any) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}: Agent {
                # agent.name} ended with output {output}"
                agent.name} ended"
        )

    async def on_handoff(self,
                         context: RunContextWrapper,
                         agent: Agent,
                         source: Agent) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}: Agent {
                source.name} handed off to {agent.name}"
        )

    async def on_tool_start(self,
                            context: RunContextWrapper,
                            agent: Agent,
                            tool: Tool) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}:"
            f" Agent {agent.name} started tool {tool.name}"
            f" with context: {context.context}"
        )

    async def on_tool_end(self,
                          context: RunContextWrapper,
                          agent: Agent,
                          tool: Tool,
                          result: str) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}: Agent {
                # agent.name} ended tool {tool.name} with result {result}"
                agent.name} ended tool {tool.name}"
        )


async def main():

    context = {
        "user_id": os.getenv("ARCADE_USER_ID"),
    }

    client = AsyncArcade()

    arcade_tools = await get_arcade_tools(
        client, toolkits=["GoogleSlides"]
    )

    for tool in arcade_tools:
        # - human in the loop
        if tool.name in ENFORCE_HUMAN_CONFIRMATION:
            tool.on_invoke_tool = partial(
                confirm_tool_usage,
                tool_name=tool.name,
                callback=tool.on_invoke_tool,
            )
        # - auth
        await auth_tool(client, tool.name, user_id=context["user_id"])

    agent = Agent(
        name="",
        instructions="# Introduction
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

By following these workflows, the Google Slides AI Agent can effectively assist users in managing their presentations with ease.",
        model=os.environ["OPENAI_MODEL"],
        tools=arcade_tools,
        hooks=CustomAgentHooks(display_name="")
    )

    # initialize the conversation
    history: list[TResponseInputItem] = []
    # run the loop!
    while True:
        prompt = input("You: ")
        if prompt.lower() == "exit":
            break
        history.append({"role": "user", "content": prompt})
        try:
            result = await Runner.run(
                starting_agent=agent,
                input=history,
                context=context
            )
            history = result.to_input_list()
            print(result.final_output)
        except UserDeniedToolCall as e:
            history.extend([
                {"role": "assistant",
                 "content": f"Please confirm the call to {e.tool_name}"},
                {"role": "user",
                 "content": "I changed my mind, please don't do it!"},
                {"role": "assistant",
                 "content": f"Sure, I cancelled the call to {e.tool_name}."
                 " What else can I do for you today?"
                 },
            ])
            print(history[-1]["content"])

if __name__ == "__main__":
    import asyncio

    asyncio.run(main())