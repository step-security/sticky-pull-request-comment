import * as fs from "node:fs"
import * as core from "@actions/core"
import * as github from "@actions/github"
import axios, {isAxiosError} from "axios"
import {
  commentsEqual,
  createComment,
  deleteComment,
  findPreviousComment,
  getBodyOf,
  minimizeComment,
  updateComment,
} from "./comment"
import {
  append,
  deleteOldComment,
  getBody,
  githubToken,
  header,
  hideAndRecreate,
  hideClassify,
  hideDetails,
  hideOldComment,
  ignoreEmpty,
  onlyCreateComment,
  onlyUpdateComment,
  pullRequestNumber,
  recreate,
  repo,
  skipUnchanged,
} from "./config"

async function validateSubscription(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH
  let repoPrivate: boolean | undefined

  if (eventPath && fs.existsSync(eventPath)) {
    const eventData = JSON.parse(fs.readFileSync(eventPath, "utf8"))
    repoPrivate = eventData?.repository?.private
  }

  const upstream = "marocchino/sticky-pull-request-comment"
  const action = process.env.GITHUB_ACTION_REPOSITORY
  const docsUrl = "https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions"

  core.info("")
  core.info("\u001b[1;36mStepSecurity Maintained Action\u001b[0m")
  core.info(`Secure drop-in replacement for ${upstream}`)
  if (repoPrivate === false) core.info("\u001b[32m\u2713 Free for public repositories\u001b[0m")
  core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`)
  core.info("")

  if (repoPrivate === false) return

  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com"
  const body: Record<string, string> = {action: action || ""}
  if (serverUrl !== "https://github.com") body.ghes_server = serverUrl
  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      body,
      {timeout: 3000},
    )
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      core.error(
        `\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`,
      )
      core.error(`\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`)
      process.exit(1)
    }
    core.info("Timeout or API not reachable. Continuing to next step.")
  }
}

async function run(): Promise<undefined> {
  if (Number.isNaN(pullRequestNumber) || pullRequestNumber < 1) {
    core.info("no pull request numbers given: skip step")
    return
  }

  try {
    await validateSubscription()
    const body = await getBody()

    if (!body && ignoreEmpty) {
      core.info("no body given: skip step by ignoreEmpty")
      return
    }

    if (!deleteOldComment && !hideOldComment && !body) {
      throw new Error("Either message or path input is required")
    }

    if (deleteOldComment && recreate) {
      throw new Error("delete and recreate cannot be both set to true")
    }

    if (onlyCreateComment && onlyUpdateComment) {
      throw new Error("only_create and only_update cannot be both set to true")
    }

    if (hideOldComment && hideAndRecreate) {
      throw new Error("hide and hide_and_recreate cannot be both set to true")
    }

    const octokit = github.getOctokit(githubToken)
    const previous = await findPreviousComment(octokit, repo, pullRequestNumber, header)

    core.setOutput("previous_comment_id", previous?.id)

    if (deleteOldComment) {
      if (previous) {
        await deleteComment(octokit, previous.id)
      }
      return
    }

    if (!previous) {
      if (onlyUpdateComment) {
        return
      }
      const created = await createComment(octokit, repo, pullRequestNumber, body, header)
      core.setOutput("created_comment_id", created?.data.id)
      return
    }

    if (onlyCreateComment) {
      // don't comment anything, user specified only_create and there is an
      // existing comment, so this is probably a placeholder / introduction one.
      return
    }

    if (hideOldComment) {
      await minimizeComment(octokit, previous.id, hideClassify)
      return
    }

    if (skipUnchanged && commentsEqual(body, previous.body || "", header)) {
      // don't recreate or update if the message is unchanged
      return
    }

    const previousBody = getBodyOf({body: previous.body || ""}, append, hideDetails)
    if (recreate) {
      await deleteComment(octokit, previous.id)
      const created = await createComment(
        octokit,
        repo,
        pullRequestNumber,
        body,
        header,
        previousBody,
      )
      core.setOutput("created_comment_id", created?.data.id)
      return
    }

    if (hideAndRecreate) {
      await minimizeComment(octokit, previous.id, hideClassify)
      const created = await createComment(octokit, repo, pullRequestNumber, body, header)
      core.setOutput("created_comment_id", created?.data.id)
      return
    }

    await updateComment(octokit, previous.id, body, header, previousBody)
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    }
  }
}

run()
