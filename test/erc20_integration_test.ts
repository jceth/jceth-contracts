import { expect } from "chai";
import { ethers as ethersType } from "ethers";
import { ethers, waffle, upgrades } from "hardhat";
import { DummyContract, JointControlETHV0, TestToken } from "../typechain";
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

const deployTokenContract = async function (): Promise<TestToken> {
  const TestToken = await ethers.getContractFactory("TestToken", {
    signer: committeeSigner,
    provider: provider,
  });
  return await TestToken.deploy();
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

describe("[ERC20 Integration test]", function () {
  it("mint()", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const account = await jcEth.getAccount(1);
    const accountAddress = account.accountAddress;

    const testToken = await deployTokenContract();

    await testToken.mint(accountAddress, ethers.utils.parseEther("1.0"));
    expect(await testToken.balanceOf(accountAddress)).to.equal(
      ethers.utils.parseEther("1.0")
    );
  });

  it("transfer()", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const account = await jcEth.getAccount(1);
    const accountAddress = account.accountAddress;

    const testToken = await deployTokenContract();

    // deposit some token to account
    await testToken.mint(accountAddress, ethers.utils.parseEther("1.0"));

    const preExeBalanceReceiver = await testToken.balanceOf(
      TOKEN_RECEIVER.address
    );
    const preExeBalanceSender = await testToken.balanceOf(accountAddress);

    // Make transfer proposal
    const TestToken = await ethers.getContractFactory("TestToken", {
      signer: committeeSigner,
      provider: provider,
    });
    const data = TestToken.interface.encodeFunctionData("transfer", [
      TOKEN_RECEIVER.address,
      TRANSFER_AMOUNT,
    ]);

    // submit & approve
    await submitAndApproveProposal(jcEth, testToken.address, data);

    // exe
    await jcEth.execute({ accountNumber: 1, proposalNumber: 1 });

    // check state //

    const postExeBalanceReceiver = await testToken.balanceOf(
      TOKEN_RECEIVER.address
    );
    expect(postExeBalanceReceiver).to.equal(
      preExeBalanceReceiver.add(TRANSFER_AMOUNT)
    );

    const postExeBalanceSender = await testToken.balanceOf(accountAddress);
    expect(postExeBalanceSender).to.equal(
      preExeBalanceSender.sub(TRANSFER_AMOUNT)
    );
  });

  it("transferFrom()", async function () {
    // Test TOKEN_RECEIVER approve accountAddress.
    // Then accountAddress try to call transferFrom()

    const [, jcEth] = await newAccountCommittee3();
    const account = await jcEth.getAccount(1);
    const accountAddress = account.accountAddress;

    const testToken = await deployTokenContract();

    // deposit some token to receiver
    await testToken.mint(
      TOKEN_RECEIVER.address,
      ethers.utils.parseEther("1.0")
    );

    // approve accountAddress //
    const TestTokenTR = await ethers.getContractFactory("TestToken", {
      signer: TOKEN_RECEIVER,
      provider: provider,
    });
    const testTokenTR = TestTokenTR.attach(testToken.address);
    await testTokenTR.approve(
      accountAddress,
      ethers.utils.parseEther(`${TRANSFER_AMOUNT}`)
    );

    const preExeBalanceTR = await testToken.balanceOf(TOKEN_RECEIVER.address);
    const preExeBalanceAccount = await testToken.balanceOf(accountAddress);

    // transfer from //
    const transferAmount = 0.01;
    const data = TestTokenTR.interface.encodeFunctionData("transferFrom", [
      TOKEN_RECEIVER.address,
      accountAddress,
      ethers.utils.parseEther(`${transferAmount}`),
    ]);
    await submitAndApproveProposal(jcEth, testToken.address, data);
    await jcEth.execute({ accountNumber: 1, proposalNumber: 1 });

    expect(
      await testToken.balanceOf(TOKEN_RECEIVER.address),
      "TR balance reduced"
    ).to.equal(
      preExeBalanceTR.sub(ethers.utils.parseEther(`${transferAmount}`))
    );
    expect(
      await testToken.balanceOf(accountAddress),
      "account balance increased"
    ).to.equal(
      preExeBalanceAccount.add(ethers.utils.parseEther(`${transferAmount}`))
    );
  });

  it("approve()", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const account = await jcEth.getAccount(1);
    const accountAddress = account.accountAddress;

    const testToken = await deployTokenContract();

    // deposit some token to account
    await testToken.mint(accountAddress, ethers.utils.parseEther("1.0"));

    // Make approve proposal
    const TestToken = await ethers.getContractFactory("TestToken", {
      signer: committeeSigner,
      provider: provider,
    });
    const data = TestToken.interface.encodeFunctionData("approve", [
      TOKEN_RECEIVER.address,
      ethers.utils.parseEther(`${TRANSFER_AMOUNT}`),
    ]);

    // submit & approve
    await submitAndApproveProposal(jcEth, testToken.address, data);

    // exe
    await jcEth.execute({ accountNumber: 1, proposalNumber: 1 });

    // check state //
    const allowance = await testToken.allowance(
      accountAddress,
      TOKEN_RECEIVER.address
    );
    expect(allowance).to.equal(ethers.utils.parseEther(`${TRANSFER_AMOUNT}`));
  });

  it("increaseAllowance() & decreaseAllowance()", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const account = await jcEth.getAccount(1);
    const accountAddress = account.accountAddress;

    const testToken = await deployTokenContract();

    // deposit some token to account
    await testToken.mint(accountAddress, ethers.utils.parseEther("1.0"));

    const TestToken = await ethers.getContractFactory("TestToken", {
      signer: committeeSigner,
      provider: provider,
    });

    // 1) Make increaseAllowance() proposal
    let data = TestToken.interface.encodeFunctionData("increaseAllowance", [
      TOKEN_RECEIVER.address,
      ethers.utils.parseEther(`${TRANSFER_AMOUNT}`),
    ]);
    await submitAndApproveProposal(jcEth, testToken.address, data, 1);
    await jcEth.execute({ accountNumber: 1, proposalNumber: 1 });

    // check state //
    expect(
      await testToken.allowance(accountAddress, TOKEN_RECEIVER.address),
      "increase amount works"
    ).to.equal(ethers.utils.parseEther(`${TRANSFER_AMOUNT}`));

    // 2) Make decreaseAllowance() proposal
    data = TestToken.interface.encodeFunctionData("decreaseAllowance", [
      TOKEN_RECEIVER.address,
      ethers.utils.parseEther(`${TRANSFER_AMOUNT}`),
    ]);
    await submitAndApproveProposal(jcEth, testToken.address, data, 2);
    await jcEth.execute({ accountNumber: 1, proposalNumber: 2 });

    // check state //
    expect(
      await testToken.allowance(accountAddress, TOKEN_RECEIVER.address),
      "decrease amount works"
    ).to.equal(ethers.utils.parseEther(`0`));
  });
});
