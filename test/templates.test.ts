import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { parse } from 'yaml';

// The CI templates ship in the package and people copy them into their
// pipelines, where a mistake costs them a push. GitHub's workflow lints itself
// only by running, so it gets parsed. GitLab publishes its CI schema (`ci.json`
// in gitlab-org/gitlab, app/assets/javascripts/editor/schema/; copied to
// test/fixtures/gitlab-ci.schema.json): the GitLab template is validated
// against it, which catches unknown keys like `artifacts:reports:markdown` or
// a job-level `expose_as` before an adopter's lint does.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the GitHub template parses and has the fuzz job', () => {
  const doc = parse(read('../templates/github/fuzz.yml')) as {
    jobs: Record<string, unknown>;
  };
  assert.ok(doc.jobs?.fuzz, 'jobs.fuzz');
});

// Issue #43: a baseline of one nightly made a bug that nightly missed "new"
// again on the next PR. Each nightly runs on the previous one's state.json.
test('the GitHub nightly carries the previous nightly’s state on', () => {
  const doc = parse(read('../templates/github/fuzz.yml')) as {
    jobs: { fuzz: { steps: { name?: string; if?: string; run?: string }[] } };
  };
  const steps = doc.jobs.fuzz.steps;
  const step = (name: string) => steps.find((s) => s.name === name)!;
  for (const name of ['find the latest nightly', 'download it']) {
    assert.doesNotMatch(step(name).if ?? '', /pull_request/, `${name} runs on the nightly too`);
  }
  assert.match(step('fuzz').run!, /--baseline tmp\/baseline\/state\.json/);
  // The gate stays a pull request's.
  assert.match(step('gate').if!, /pull_request/);
});

interface GitLabJob {
  script: string[];
  allow_failure?: boolean;
  rules: { if: string }[];
  artifacts: { expire_in: string; paths: string[]; expose_as?: string; when?: string };
}
const gitlab = () => parse(read('../templates/gitlab/fuzz.gitlab-ci.yml')) as Record<string, GitLabJob>;

test('the GitLab template validates against GitLab’s CI schema', () => {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  const validate = ajv.compile(JSON.parse(read('fixtures/gitlab-ci.schema.json')));
  const ok = validate(gitlab());
  assert.ok(ok, ajv.errorsText(validate.errors, { separator: '\n' }));
});

test('the GitLab job carries the nightly baseline and never reddens a merge request', () => {
  const job = gitlab().fuzz!;
  assert.ok(job, 'the fuzz job');

  // `report --fail-on new` exits 1 on a finding: that's for a person to read,
  // not a red pipeline.
  assert.equal(job.allow_failure, true, 'allow_failure');

  // The nightly's artifact is the baseline every merge request downloads.
  assert.ok(job.artifacts.paths.includes('bombadil-report/'), `bombadil-report/ in artifacts.paths: ${job.artifacts.paths}`);
  assert.ok(job.artifacts.expire_in, 'a long expire_in');
  assert.equal(job.artifacts.when, 'always');
  assert.ok(job.artifacts.expose_as, 'the report link on the MR');

  // One job answers to both pipeline sources.
  const ifs = job.rules.map((r) => r.if);
  for (const want of ['$CI_PIPELINE_SOURCE == "schedule"', '$CI_PIPELINE_SOURCE == "merge_request_event"']) {
    assert.ok(ifs.some((one) => one.includes(want)), `a rule for ${want}: ${ifs.join(' / ')}`);
  }

  // The baseline is the latest successful schedule pipeline's fuzz job,
  // downloaded by job id. The by-ref download only looks in the latest
  // successful pipeline on the branch (Project#latest_successful_build_for_ref),
  // which a push to main hides the nightly behind; it's the fallback for a
  // GitLab that won't list pipelines for CI_JOB_TOKEN. Neither takes a SHA.
  const script = job.script.join('\n');
  assert.match(script, /\/pipelines\?ref=\$CI_DEFAULT_BRANCH&source=schedule&status=success/);
  assert.match(script, /\/jobs\/\$job\/artifacts/);
  assert.match(script, /jobs\/artifacts\/\$CI_DEFAULT_BRANCH\/download\?job=fuzz/);
  assert.doesNotMatch(script, /jobs\/artifacts\/\$sha/);

  // Every project, not only the first: `affected --all` gives the same
  // per-project shape for one project as for several.
  assert.match(script, /affected --all --json/);
  assert.match(script, /run --project "\$p"/);
});

test('the GitLab nightly carries the previous nightly’s state on, and gates only merge requests', () => {
  const script = gitlab().fuzz!.script.join('\n');
  // The download isn't behind the merge-request branch.
  const download = script.indexOf('/pipelines?ref=$CI_DEFAULT_BRANCH');
  const before = script.slice(0, download);
  assert.doesNotMatch(before.slice(before.lastIndexOf('# ---- the baseline')), /if \[ "\$nightly" = 0 \]/);
  // The report builds on it either way; only a merge request fails on new.
  assert.match(script, /args=\(--baseline "\$base\/state\.json" --fail-on "\$\(\[ "\$nightly" = 0 \] && echo new \|\| echo none\)"\)/);
});
