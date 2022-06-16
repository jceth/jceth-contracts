import { expect } from "chai";
import { ethers as ethersType } from "ethers";
import { ethers, waffle, upgrades } from "hardhat";
import { DummyContract, JointControlETHV0, TestNFT } from "../typechain";
import {
  UNSAFE_ACCOUNTS,
  VoteMode,
  ProposalType,
  getRandomInt,
  IProposal,
  IJCAccount,
  IProposalContent,
  IPoll,
} from "./util";

// 3-member committee
const committee3 = UNSAFE_ACCOUNTS.slice(0, 3);
const committee3AddressList = committee3.map((x) => x.address);

// Committee signer, 1st account
const committeeSigner = UNSAFE_ACCOUNTS[0];

// Non-comitte signer, last account
const nonCommitteeSigner = UNSAFE_ACCOUNTS[UNSAFE_ACCOUNTS.length - 1];

const TRANSFER_AMOUNT = ethers.utils.parseEther("0.2");

const TOKEN_RECEIVER = UNSAFE_ACCOUNTS[UNSAFE_ACCOUNTS.length - 1];

const provider = waffle.provider;

const accountAlias = ethers.utils.formatBytes32String("test account");

const deployJcEthContract = async function (): Promise<JointControlETHV0> {
  const JointControlETHV0 = await ethers.getContractFactory(
    "JointControlETHV0",
    { signer: committeeSigner, provider: provider }
  );
  return await JointControlETHV0.deploy();
};

const newAccountCommittee3 = async function (): Promise<
  [ethersType.ContractTransaction, JointControlETHV0]
> {
  const jcEth = await deployJcEthContract();

  const tx = await jcEth.newAccount(
    VoteMode.Majority,
    committee3AddressList,
    accountAlias
  );

  return [tx, jcEth];
};

const deployTokenContract = async function (): Promise<TestNFT> {
  const TestNFT = await ethers.getContractFactory("TestNFT", {
    signer: committeeSigner,
    provider: provider,
  });
  return await TestNFT.deploy();
};

const submitAndApproveProposal = async function (
  jcEth: JointControlETHV0,
  target: string,
  proposalData: string,
  proposalNumber: number = 1
) {
  const proposalContent: IProposalContent = {
    accountNumber: 1,
    proposalType: ProposalType.ContractInteraction,
    target: target,
    data: proposalData,
    deadline: 100,
  };
  await jcEth.newProposal(proposalContent, true);

  for (const member of committee3.slice(1, 3)) {
    const JointControlETHV0Member = await ethers.getContractFactory(
      "JointControlETHV0",
      { signer: member, provider: provider }
    );
    const jcEthMember = JointControlETHV0Member.attach(jcEth.address);
    const poll: IPoll = {
      accountNumber: 1,
      proposalNumber: proposalNumber,
      approval: true,
    };
    await jcEthMember.newPoll(poll);
  }
};

const tokenId = 11;
const tokenId2 = 22;
const tokenId3 = 33;

describe("ERC721 integration test", function () {
  it("safeMint()", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const account = await jcEth.getAccount(1);
    const accountAddress = account.accountAddress;

    const testNft = await deployTokenContract();

    await testNft.safeMint(accountAddress, tokenId);
    expect(await testNft.ownerOf(tokenId)).to.hexEqual(accountAddress);
    expect(await testNft.balanceOf(accountAddress)).to.equal(1);
  });

  it("safeTransferFrom()", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const account = await jcEth.getAccount(1);
    const accountAddress = account.accountAddress;

    const testNft = await deployTokenContract();

    // let account address own an NFT
    await testNft.safeMint(accountAddress, tokenId);

    // Make transfer proposal
    const TestNFT = await ethers.getContractFactory("TestNFT", {
      signer: committeeSigner,
      provider: provider,
    });
    const data = TestNFT.interface.encodeFunctionData(
      "safeTransferFrom(address,address,uint256)",
      [accountAddress, TOKEN_RECEIVER.address, tokenId]
    );
    await submitAndApproveProposal(jcEth, testNft.address, data);
    await jcEth.execute({ accountNumber: 1, proposalNumber: 1 });

    expect(await testNft.ownerOf(tokenId)).to.hexEqual(TOKEN_RECEIVER.address);
  });

  it("transferFrom()", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const account = await jcEth.getAccount(1);
    const accountAddress = account.accountAddress;

    const testNft = await deployTokenContract();

    // let account address own an NFT
    await testNft.safeMint(accountAddress, tokenId);

    // Make transfer proposal
    const TestNFT = await ethers.getContractFactory("TestNFT", {
      signer: committeeSigner,
      provider: provider,
    });
    const data = TestNFT.interface.encodeFunctionData(
      "transferFrom(address,address,uint256)",
      [accountAddress, TOKEN_RECEIVER.address, tokenId]
    );
    await submitAndApproveProposal(jcEth, testNft.address, data);
    await jcEth.execute({ accountNumber: 1, proposalNumber: 1 });

    expect(await testNft.ownerOf(tokenId)).to.hexEqual(TOKEN_RECEIVER.address);
  });

  it("approve()", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const account = await jcEth.getAccount(1);
    const accountAddress = account.accountAddress;

    const testNft = await deployTokenContract();

    // let account address own an NFT
    await testNft.safeMint(accountAddress, tokenId);

    // Make transfer proposal
    const TestNFT = await ethers.getContractFactory("TestNFT", {
      signer: committeeSigner,
      provider: provider,
    });
    const data = TestNFT.interface.encodeFunctionData("approve", [
      TOKEN_RECEIVER.address,
      tokenId,
    ]);
    await submitAndApproveProposal(jcEth, testNft.address, data);
    await jcEth.execute({ accountNumber: 1, proposalNumber: 1 });

    expect(await testNft.getApproved(tokenId)).to.hexEqual(
      TOKEN_RECEIVER.address
    );
  });

  it("setApprovalForAll()", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const account = await jcEth.getAccount(1);
    const accountAddress = account.accountAddress;

    const testNft = await deployTokenContract();

    // let account address own an NFT
    await testNft.safeMint(accountAddress, tokenId);
    await testNft.safeMint(accountAddress, tokenId2);
    await testNft.safeMint(accountAddress, tokenId3);

    // Make transfer proposal
    const TestNFT = await ethers.getContractFactory("TestNFT", {
      signer: committeeSigner,
      provider: provider,
    });
    const data = TestNFT.interface.encodeFunctionData("setApprovalForAll", [
      TOKEN_RECEIVER.address,
      true,
    ]);
    await submitAndApproveProposal(jcEth, testNft.address, data);
    await jcEth.execute({ accountNumber: 1, proposalNumber: 1 });

    expect(
      await testNft.isApprovedForAll(accountAddress, TOKEN_RECEIVER.address)
    ).to.equal(true);
  });
});
