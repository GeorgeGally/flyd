import {
  listPendingProposals,
  getProposal,
} from '../work-intelligence/skillify/proposal-store.js';
import {
  confirmProposal,
  declineProposal,
  confirmAllPending,
  declineAllPending,
} from '../work-intelligence/skillify/confirm.js';

function printProposal(proposal: NonNullable<ReturnType<typeof getProposal>>): void {
  console.log(`id: ${proposal.id}`);
  console.log(`kind: ${proposal.kind}`);
  console.log(`target: ${proposal.targetPath}`);
  console.log(`revision: ${proposal.revision}`);
  console.log(`status: ${proposal.status}`);
  console.log(`expires: ${proposal.expiresAt}`);
  console.log('---');
  console.log(proposal.body.slice(0, 500));
}

export async function runSkillify(
  command: 'list' | 'show' | 'confirm' | 'decline',
  id?: string,
  opts?: { all?: boolean; revision?: number },
): Promise<void> {
  if (command === 'list') {
    const pending = listPendingProposals();
    if (pending.length === 0) {
      console.log('No pending skillify proposals');
      return;
    }
    for (const proposal of pending) {
      console.log(`${proposal.id.slice(0, 8)}  ${proposal.kind}  ${proposal.targetPath}`);
    }
    return;
  }

  if (command === 'show') {
    if (!id) {
      console.error('Usage: flyd skillify show <id>');
      process.exitCode = 1;
      return;
    }
    const proposal = getProposal(id) ?? listPendingProposals().find((p) => p.id.startsWith(id));
    if (!proposal) {
      console.error(`Proposal not found: ${id}`);
      process.exitCode = 1;
      return;
    }
    printProposal(proposal);
    return;
  }

  if (command === 'confirm') {
    if (opts?.all) {
      const results = confirmAllPending();
      const ok = results.filter((r) => r.ok);
      console.log(`Confirmed ${ok.length}/${results.length} proposals`);
      for (const result of ok) {
        if (result.writtenPath) console.log(`  wrote ${result.writtenPath}`);
      }
      return;
    }
    if (!id) {
      console.error('Usage: flyd skillify confirm <id> [--revision N]');
      process.exitCode = 1;
      return;
    }
    const proposal = getProposal(id) ?? listPendingProposals().find((p) => p.id.startsWith(id));
    if (!proposal) {
      console.error(`Proposal not found: ${id}`);
      process.exitCode = 1;
      return;
    }
    const revision = opts?.revision ?? proposal.revision;
    const result = confirmProposal(proposal.id, revision);
    if (!result.ok) {
      console.error(result.error ?? 'Confirm failed');
      process.exitCode = 1;
      return;
    }
    console.log(`Wrote ${result.writtenPath}`);
    return;
  }

  if (command === 'decline') {
    if (opts?.all) {
      const results = declineAllPending();
      console.log(`Declined ${results.filter((r) => r.ok).length}/${results.length} proposals`);
      return;
    }
    if (!id) {
      console.error('Usage: flyd skillify decline <id> [--revision N]');
      process.exitCode = 1;
      return;
    }
    const proposal = getProposal(id) ?? listPendingProposals().find((p) => p.id.startsWith(id));
    if (!proposal) {
      console.error(`Proposal not found: ${id}`);
      process.exitCode = 1;
      return;
    }
    const revision = opts?.revision ?? proposal.revision;
    const result = declineProposal(proposal.id, revision);
    if (!result.ok) {
      console.error(result.error ?? 'Decline failed');
      process.exitCode = 1;
      return;
    }
    console.log(`Declined ${proposal.id}`);
  }
}
