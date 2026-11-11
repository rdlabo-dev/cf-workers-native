import assert from "node:assert/strict";
import test from "node:test";
import {
  releaseVersion,
  resolveRelease,
  isReleaseCurrent,
} from "./npm-release.mjs";

const sha = "a".repeat(40);
function fixture() {
  const state = {
    main: sha,
    comparison: "identical",
    pulls: [
      {
        number: 43,
        merged_at: "2026-10-19",
        base: { ref: "main" },
        merge_commit_sha: sha,
      },
    ],
    runs: [{ run_number: 2, status: "completed", conclusion: "success" }],
    pkg: { name: "cf-workers-native", version: "0.1.1" },
  };
  const context = {
    repo: { owner: "rdlabo-dev", repo: "cf-workers-native" },
    eventName: "workflow_run",
    payload: {
      workflow_run: {
        event: "push",
        head_branch: "main",
        head_sha: sha,
        head_repository: { full_name: "rdlabo-dev/cf-workers-native" },
        path: ".github/workflows/ci.yml",
        conclusion: "success",
      },
    },
  };
  const github = {
    rest: {
      repos: {
        getBranch: async () => ({ data: { commit: { sha: state.main } } }),
        getCommit: async () => ({ data: { sha } }),
        compareCommits: async () => ({ data: { status: state.comparison } }),
        getContent: async () => ({
          data: {
            content: Buffer.from(JSON.stringify(state.pkg)).toString("base64"),
          },
        }),
        listPullRequestsAssociatedWithCommit: "pulls",
      },
      actions: { listWorkflowRuns: "runs" },
    },
    paginate: async (method, params) => {
      assert.equal(params[method === "runs" ? "head_sha" : "commit_sha"], sha);
      return state[method];
    },
  };
  return { state, context, github };
}

test("stable and revision tags never select the beta channel", () => {
  assert.deepEqual(releaseVersion("0.1.1", "v0.1.1"), {
    version: "0.1.1",
    channel: "latest",
  });
  assert.deepEqual(releaseVersion("0.2.0-rc.1", "v0.2.0-rc.1"), {
    version: "0.2.0-rc.1",
    channel: "next",
  });
  for (const version of ["01.1.0", "1.0.0-01", "1.0.0-", "1.0.0;echo"]) {
    assert.throws(() => releaseVersion(version, `v${version}`));
  }
  assert.throws(() => releaseVersion("0.1.1", "v0.1.2"));
});

test("a successful exact merge commit creates an immutable beta", async () => {
  const { github, context } = fixture();
  assert.deepEqual(await resolveRelease(github, context), {
    sha,
    version: "0.1.1-beta.pr43.shaaaaaaaaaaaaa",
    channel: "beta",
  });
});

test("PR, fork, failed and superseded workflow runs cannot publish", async () => {
  for (const change of [
    (f) => (f.context.payload.workflow_run.event = "pull_request"),
    (f) =>
      (f.context.payload.workflow_run.head_repository.full_name =
        "someone/fork"),
    (f) => (f.context.payload.workflow_run.conclusion = "failure"),
    (f) =>
      (f.context.payload.workflow_run.path = ".github/workflows/other.yml"),
    (f) => (f.state.main = "b".repeat(40)),
    (f) => (f.state.pulls = []),
    (f) => (f.state.pulls[0].merge_commit_sha = "b".repeat(40)),
  ]) {
    const f = fixture();
    change(f);
    assert.equal(await resolveRelease(f.github, f.context), null);
  }
});

test("an older successful run cannot hide a newer failed or incomplete CI run", async () => {
  for (const conclusion of ["failure", "cancelled", null]) {
    const f = fixture();
    f.state.runs.push({
      run_number: 3,
      status: conclusion ? "completed" : "in_progress",
      conclusion,
    });
    await assert.rejects(
      resolveRelease(f.github, f.context),
      /must pass Compatibility/,
    );
  }
});

test("tag publication requires main ancestry, matching package version and exact CI", async () => {
  const f = fixture();
  f.context.eventName = "push";
  f.context.ref = "refs/tags/v0.1.1";
  assert.deepEqual(await resolveRelease(f.github, f.context), {
    sha,
    version: "0.1.1",
    channel: "latest",
  });
  f.state.pkg.version = "0.2.0-rc.1";
  f.context.ref = "refs/tags/v0.2.0-rc.1";
  assert.equal((await resolveRelease(f.github, f.context)).channel, "next");
  f.state.comparison = "diverged";
  await assert.rejects(resolveRelease(f.github, f.context), /commit on main/);
  f.state.comparison = "identical";
  f.state.runs = [];
  await assert.rejects(
    resolveRelease(f.github, f.context),
    /must pass Compatibility/,
  );
});

function commentFixture() {
  const f = fixture();
  f.context.eventName = "issue_comment";
  f.context.payload = {
    action: "created",
    issue: { number: 43, pull_request: {} },
    comment: {
      body: "/beta",
      created_at: "2026-10-19T07:00:00Z",
      user: { login: "maintainer" },
    },
  };
  f.state.permission = "maintain";
  f.state.pr = {
    number: 43,
    state: "open",
    draft: false,
    base: { ref: "main" },
    head: { sha, repo: { full_name: "contributor/fork" } },
    updated_at: "2026-10-19T07:00:00Z",
  };
  f.state.files = [];
  f.state.runs[0].pull_requests = [{ number: 43 }];
  f.github.rest.repos.getCollaboratorPermissionLevel = async () => ({
    data: { permission: f.state.permission, role_name: f.state.role },
  });
  f.github.rest.pulls = {
    get: async () => ({ data: f.state.pr }),
    listFiles: "files",
  };
  f.github.paginate = async (method, params) => {
    if (method === "runs") assert.equal(params.event, "pull_request");
    return f.state[method];
  };
  return f;
}

test("/beta supports an authorized fork head without changing latest", async () => {
  const f = commentFixture();
  const plan = await resolveRelease(f.github, f.context);
  assert.deepEqual(plan, {
    sha,
    repository: "contributor/fork",
    pr: 43,
    version: "0.1.1-beta.pr43.shaaaaaaaaaaaaa",
    channel: "beta",
  });
  assert.equal(await isReleaseCurrent(f.github, f.context, plan), true);
});

test("/beta rejects unauthorized commenters, ordinary issues and closed/draft PRs", async () => {
  for (const change of [
    (f) => (f.state.permission = "write"),
    (f) => (f.context.payload.issue.pull_request = undefined),
    (f) => (f.context.payload.comment.body = "/beta please"),
    (f) => (f.context.payload.action = "edited"),
    (f) => (f.state.pr.state = "closed"),
    (f) => (f.state.pr.draft = true),
    (f) => (f.state.pr.base.ref = "other"),
  ]) {
    const f = commentFixture();
    change(f);
    assert.equal(await resolveRelease(f.github, f.context), null);
  }
});

test("/beta refuses workflow changes, unmatched PR CI and updates after the comment", async () => {
  for (const change of [
    (f) => (f.state.files = [{ filename: ".github/workflows/ci.yml" }]),
    (f) =>
      (f.state.files = [
        {
          filename: "moved.yml",
          previous_filename: ".github/workflows/ci.yml",
        },
      ]),
    (f) => (f.state.files = [{ filename: ".github/scripts/npm-release.mjs" }]),
    (f) => (f.state.runs[0].pull_requests = [{ number: 99 }]),
    (f) => (f.state.runs[0].conclusion = "failure"),
    (f) => (f.state.pr.updated_at = "2026-10-19T07:00:01Z"),
  ]) {
    const f = commentFixture();
    change(f);
    await assert.rejects(resolveRelease(f.github, f.context));
  }
});

test("publication rechecks current permission, head and CI after building", async () => {
  for (const change of [
    (f) => (f.state.permission = "write"),
    (f) => (f.state.pr.head.sha = "b".repeat(40)),
    (f) => (f.state.pr.state = "closed"),
  ]) {
    const f = commentFixture();
    const plan = await resolveRelease(f.github, f.context);
    change(f);
    assert.equal(await isReleaseCurrent(f.github, f.context, plan), false);
  }
  const f = commentFixture();
  const plan = await resolveRelease(f.github, f.context);
  f.state.runs[0].conclusion = "failure";
  await assert.rejects(isReleaseCurrent(f.github, f.context, plan));
});

test("GitHub maintain role is accepted even when the legacy permission is write", async () => {
  const f = commentFixture();
  f.state.permission = "write";
  f.state.role = "maintain";
  assert.equal((await resolveRelease(f.github, f.context)).channel, "beta");
});

test("dispatch keeps the original authorized PR head", async () => {
  const f = commentFixture();
  const comment = {
    ...f.context.payload.comment,
    updated_at: f.context.payload.comment.created_at,
    issue_url: "https://api.github.com/repos/rdlabo-dev/cf-workers-native/issues/43",
  };
  f.github.rest.issues = {
    getComment: async ({ comment_id }) => {
      assert.equal(comment_id, 123);
      return { data: comment };
    },
  };
  const original = await resolveRelease(f.github, f.context);
  f.context.eventName = "workflow_dispatch";
  f.context.payload = { inputs: { "comment-id": "123", "head-sha": sha } };
  assert.deepEqual(await resolveRelease(f.github, f.context), original);
  f.state.pr.head.sha = "b".repeat(40);
  assert.equal(await isReleaseCurrent(f.github, f.context, original), false);
  f.state.pr.head.sha = sha;
  comment.updated_at = "2026-10-20";
  await assert.rejects(resolveRelease(f.github, f.context), /no longer valid/);
});
