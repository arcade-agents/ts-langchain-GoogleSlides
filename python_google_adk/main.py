from arcadepy import AsyncArcade
from dotenv import load_dotenv
from google.adk import Agent, Runner
from google.adk.artifacts import InMemoryArtifactService
from google.adk.models.lite_llm import LiteLlm
from google.adk.sessions import InMemorySessionService, Session
from google_adk_arcade.tools import get_arcade_tools
from google.genai import types
from human_in_the_loop import auth_tool, confirm_tool_usage

import os

load_dotenv(override=True)


async def main():
    app_name = "my_agent"
    user_id = os.getenv("ARCADE_USER_ID")

    session_service = InMemorySessionService()
    artifact_service = InMemoryArtifactService()
    client = AsyncArcade()

    agent_tools = await get_arcade_tools(
        client, toolkits=["GoogleSlides"]
    )

    for tool in agent_tools:
        await auth_tool(client, tool_name=tool.name, user_id=user_id)

    agent = Agent(
        model=LiteLlm(model=f"openai/{os.environ["OPENAI_MODEL"]}"),
        name="google_agent",
        instruction="# Introduction
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
        description="An agent that uses GoogleSlides tools provided to perform any task",
        tools=agent_tools,
        before_tool_callback=[confirm_tool_usage],
    )

    session = await session_service.create_session(
        app_name=app_name, user_id=user_id, state={
            "user_id": user_id,
        }
    )
    runner = Runner(
        app_name=app_name,
        agent=agent,
        artifact_service=artifact_service,
        session_service=session_service,
    )

    async def run_prompt(session: Session, new_message: str):
        content = types.Content(
            role='user', parts=[types.Part.from_text(text=new_message)]
        )
        async for event in runner.run_async(
            user_id=user_id,
            session_id=session.id,
            new_message=content,
        ):
            if event.content.parts and event.content.parts[0].text:
                print(f'** {event.author}: {event.content.parts[0].text}')

    while True:
        user_input = input("User: ")
        if user_input.lower() == "exit":
            print("Goodbye!")
            break
        await run_prompt(session, user_input)


if __name__ == '__main__':
    import asyncio
    asyncio.run(main())