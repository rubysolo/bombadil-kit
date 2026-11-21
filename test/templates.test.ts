import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

// The CI templates ship in the package and people copy them into their
// pipelines, where a syntax error costs them a push. Nothing else runs them:
// GitHub's own workflow lints itself by running, and GitLab's lint API needs a
// token this repo doesn't have. So they get parsed here, and the parts the
// README and the kit's own docs promise get checked by name.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the GitHub template parses and has the fuzz job', () => {
  const doc = parse(read('../templates/github/fuzz.yml')) as {
    jobs: Record<string, unknown>;
  };
  assert.ok(doc.jobs?.fuzz, 'jobs.fuzz');
});

test('the GitLab template parses and carries the nightly baseline', () => {
  const doc = parse(read('../templates/gitlab/fuzz.gitlab-ci.yml')) as {
    fuzz: {
      script: unknown;
      rules: { if: string }[];
      artifacts: { expire_in: string; paths: string[]; reports: Record<string, string> };
    };
  };
  const job = doc.fuzz;
  assert.ok(job, 'the fuzz job');
  assert.ok(job.script, 'script');

  // The nightly's artifact is the baseline every merge request downloads.
  const paths = job.artifacts.paths;
  assert.ok(paths.includes('tmp/bombadil/report/'), `report folder in artifacts.paths: ${paths}`);
  assert.ok(job.artifacts.expire_in, 'a long expire_in');
  assert.equal(job.artifacts.reports.markdown, 'report.md', 'the MR note');

  // One job answers to both pipeline sources; a schedule can't take
  // `expose_as`, so the MR link is a hidden job (see the file's notes).
  const ifs = job.rules.map((r) => r.if);
  for (const want of ['$CI_PIPELINE_SOURCE == "schedule"', '$CI_PIPELINE_SOURCE == "merge_request_event"']) {
    assert.ok(ifs.some((one) => one.includes(want)), `a rule for ${want}: ${ifs.join(' / ')}`);
  }
});
