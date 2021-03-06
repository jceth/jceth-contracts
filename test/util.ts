import { ethers, waffle } from "hardhat";
import { ethers as ethersType } from "ethers";

/**
 * !!WARNING!!
 * THESE ACCOUNTS SHOULD BE USED FOR TESTS ONLY. THEY ARE UNSAFE AS THEIR ASSOCIATED
 * PRIVATE KEYS ARE PUBLIC KNOWN.
 * THEY ARE GENERATED BY RUNNING `npx hardhat node`
 */
const UNSAFE_ACCOUNTS = waffle.provider.getWallets().slice(0, 10);

enum VoteMode {
  Majority,
  Omni,
}

enum ProposalType {
  Transfer,
  ContractInteraction,
  AccounContractUpgrade,
  MultiCall,
}

function getRandomInt(maxNotIncluded: number): number {
  return Math.floor(Math.random() * maxNotIncluded);
}

interface IJCAccount {
  accountNumber: number;
  committee: Array<string>;
  founder: string;
  voteMode: VoteMode;
  numProposals: number;
  accountAlias: string;
}

interface IProposalContent {
  accountNumber: ethersType.BigNumberish;
  proposalType: ethersType.BigNumberish;
  target: string;
  data: ethersType.utils.BytesLike;
  deadline: ethersType.BigNumberish;
}

interface IProposal {
  proposalNumber: number;
  executed: boolean;
  yah: number;
  nay: number;
  advocate: string;
  content: IProposalContent;
}

interface IPoll {
  accountNumber: ethersType.BigNumberish;
  proposalNumber: ethersType.BigNumberish;
  approval: boolean;
}

export {
  UNSAFE_ACCOUNTS,
  VoteMode,
  ProposalType,
  getRandomInt,
  IProposal,
  IJCAccount,
  IProposalContent,
  IPoll,
};
