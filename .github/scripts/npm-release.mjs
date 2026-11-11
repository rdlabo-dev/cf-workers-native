const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const prerelease =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)$/;

export function releaseVersion(version, tag, pr, sha) {
  if (!stable.test(version) && !prerelease.test(version)) {
    throw new Error(`Invalid package version: ${version}`);
  }
  if (tag) {
    if (tag !== `v${version}`)
      throw new Error("Tag must match package.json version");
    return { version, channel: stable.test(version) ? "latest" : "next" };
  }
  return {
    version: `${version.split("-")[0]}-beta.pr${pr}.sha${sha.slice(0, 12)}`,
    channel: "beta",
  };
}

export async function resolveRelease(github, context) {
  if (context.eventName === "issue_comment")
    return resolveCommentBeta(github, context.payload, context.repo);
  if (context.eventName === "workflow_dispatch") {
    const inputs = context.payload.inputs;
    if (!/^[1-9]\d*$/.test(inputs?.["comment-id"]) ||
        !/^[a-f0-9]{40}$/.test(inputs?.["head-sha"])) {
      throw new Error("Invalid beta dispatch inputs");
    }
    const { data: comment } = await github.rest.issues.getComment({
      ...context.repo,
      comment_id: Number(inputs["comment-id"]),
    });
    const number = Number(comment.issue_url.match(/\/issues\/([1-9]\d*)$/)?.[1]);
    if (!number || comment.updated_at !== comment.created_at) {
      throw new Error("The original /beta comment is no longer valid");
    }
    return resolveCommentBeta(github, {
      action: "created", issue: { number, pull_request: {} }, comment,
    }, context.repo, inputs["head-sha"]);
  }
  const repo = context.repo;
  const { data: main } = await github.rest.repos.getBranch({
    ...repo,
    branch: "main",
  });
  let sha;
  let pr;
  let tag;
  if (context.eventName === "workflow_run") {
    const run = context.payload.workflow_run;
    if (
      run.event !== "push" ||
      run.head_branch !== "main" ||
      run.head_repository.full_name !== `${repo.owner}/${repo.repo}` ||
      run.path !== ".github/workflows/ci.yml" ||
      run.conclusion !== "success" ||
      run.head_sha !== main.commit.sha
    )
      return null;
    sha = run.head_sha;
    const pulls = await github.paginate(
      github.rest.repos.listPullRequestsAssociatedWithCommit,
      {
        ...repo,
        commit_sha: sha,
        per_page: 100,
      },
    );
    pr = pulls.find(
      (p) => p.merged_at && p.base.ref === "main" && p.merge_commit_sha === sha,
    )?.number;
    if (!pr) return null; // Direct pushes do not release beta packages.
  } else if (
    context.eventName === "push" &&
    context.ref.startsWith("refs/tags/v")
  ) {
    tag = context.ref.slice("refs/tags/".length);
    const { data: commit } = await github.rest.repos.getCommit({
      ...repo,
      ref: context.ref,
    });
    sha = commit.sha;
    const { data: comparison } = await github.rest.repos.compareCommits({
      ...repo,
      base: sha,
      head: main.commit.sha,
    });
    if (!["ahead", "identical"].includes(comparison.status)) {
      throw new Error("Release tags must point to a commit on main");
    }
  } else return null;

  // Require the latest main CI run for this exact commit, including tag releases.
  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    ...repo,
    workflow_id: "ci.yml",
    head_sha: sha,
    event: "push",
    branch: "main",
    per_page: 100,
  });
  const latest = runs.sort((a, b) => b.run_number - a.run_number)[0];
  if (
    !latest ||
    latest.status !== "completed" ||
    latest.conclusion !== "success"
  ) {
    throw new Error(
      "The exact release commit must pass Compatibility on main first",
    );
  }
  const { data: file } = await github.rest.repos.getContent({
    ...repo,
    path: "package.json",
    ref: sha,
  });
  const pkg = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  if (pkg.name !== "cf-workers-native")
    throw new Error("Unexpected package name");
  return { sha, ...releaseVersion(pkg.version, tag, pr, sha) };
}

async function resolveCommentBeta(github, payload, repo, expectedSha) {
  const { action, issue, comment } = payload;
  if (action !== "created" || !issue.pull_request || comment.body !== "/beta")
    return null;
  const { data: permission } =
    await github.rest.repos.getCollaboratorPermissionLevel({
      ...repo,
      username: comment.user.login,
    });
  if (
    ![permission.permission, permission.role_name].some((role) =>
      ["admin", "maintain"].includes(role),
    )
  )
    return null;
  const { data: pr } = await github.rest.pulls.get({
    ...repo,
    pull_number: issue.number,
  });
  if (
    pr.state !== "open" ||
    pr.draft ||
    pr.base.ref !== "main" ||
    !pr.head.repo
  )
    return null;
  if (expectedSha && pr.head.sha !== expectedSha) return null;
  // A queued comment must not authorize code pushed after that comment.
  if (Date.parse(pr.updated_at) > Date.parse(comment.created_at)) {
    throw new Error(
      "PR changed after /beta; post a fresh comment after CI passes",
    );
  }
  const files = await github.paginate(github.rest.pulls.listFiles, {
    ...repo,
    pull_number: issue.number,
    per_page: 100,
  });
  const protectedPath = (path = "") =>
    path.startsWith(".github/workflows/") ||
    path.startsWith(".github/scripts/");
  if (
    files.some(
      (file) =>
        protectedPath(file.filename) || protectedPath(file.previous_filename),
    )
  ) {
    throw new Error(
      "Merge release/CI workflow changes before requesting /beta",
    );
  }
  const sha = pr.head.sha;
  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    ...repo,
    workflow_id: "ci.yml",
    head_sha: sha,
    event: "pull_request",
    per_page: 100,
  });
  const latest = runs
    .filter((run) => run.pull_requests.some((p) => p.number === pr.number))
    .sort((a, b) => b.run_number - a.run_number)[0];
  if (
    !latest ||
    latest.status !== "completed" ||
    latest.conclusion !== "success"
  ) {
    throw new Error("The PR head must pass Compatibility before /beta");
  }
  const { data: file } = await github.rest.repos.getContent({
    ...repo,
    path: "package.json",
    ref: "main",
  });
  const pkg = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  if (pkg.name !== "cf-workers-native")
    throw new Error("Unexpected trusted package name");
  return {
    sha,
    repository: pr.head.repo.full_name,
    pr: pr.number,
    ...releaseVersion(pkg.version, undefined, pr.number, sha),
  };
}

export async function isReleaseCurrent(github, context, plan) {
  const current = await resolveRelease(github, context);
  return JSON.stringify(current) === JSON.stringify(plan);
}
