import { expect } from "chai";
import { ethers as ethersType } from "ethers";
import { ethers, waffle, upgrades } from "hardhat";
import {
  DummyContract,
  JointControlETHV1,
  JCETHPlaceholderBase,
} from "../typechain";
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

// 6-member committee
const committee6 = UNSAFE_ACCOUNTS.slice(0, 6);

// 3-member committee
const committee3 = UNSAFE_ACCOUNTS.slice(0, 3);
const committee3AddressList = committee3.map((x) => x.address);

// Committee signer, 1st account
const committeeSigner = UNSAFE_ACCOUNTS[0];

// Non-comitte signer, last account
const nonCommitteeSigner = UNSAFE_ACCOUNTS[UNSAFE_ACCOUNTS.length - 1];

const accountAlias = ethers.utils.formatBytes32String("test account");

const TRANSFER_AMOUNT = getRandomInt(1000000) + 1;

const newCount = getRandomInt(1000000);

const provider = waffle.provider;

const MULTI_CALL_REPEAT_BUMP = 4;

// Transfer receiver should not be same as committeeSigner. Because
// committeeSigner will pay gas fee when call execute() and we cannot
// determine it's post-call balance.
const TRANSFER_RECEIVER = committee3[1];

const deployContract = async function (): Promise<JointControlETHV1> {
  const JointControlETHV1 = await ethers.getContractFactory(
    "JointControlETHV1",
    { signer: committeeSigner, provider: provider }
  );
  return await JointControlETHV1.deploy();
};

const deployDummyContract = async function (): Promise<DummyContract> {
  const DummyContract = await ethers.getContractFactory("DummyContract", {
    signer: committeeSigner,
    provider: provider,
  });
  return await DummyContract.deploy();
};

const newAccountCommitteeN = async function (
  n: number,
  voteMode: VoteMode = VoteMode.Majority
): Promise<[ethersType.ContractTransaction, JointControlETHV1]> {
  const jcEth = await deployContract();

  const addreList = UNSAFE_ACCOUNTS.slice(0, n).map((x) => x.address);
  const tx = await jcEth.newAccount(voteMode, addreList, accountAlias);
  return [tx, jcEth];
};

const newAccountCommittee3 = async function (
  voteMode: VoteMode = VoteMode.Majority
): Promise<[ethersType.ContractTransaction, JointControlETHV1]> {
  const jcEth = await deployContract();

  const tx = await jcEth.newAccount(
    voteMode,
    committee3AddressList,
    accountAlias
  );

  return [tx, jcEth];
};

const newAccountCommittee3WithDummy = async function (
  dummy: string,
  voteMode: VoteMode = VoteMode.Majority
): Promise<[ethersType.ContractTransaction, JointControlETHV1]> {
  const jcEth = await deployContract();

  const tx = await jcEth.newAccount(
    voteMode,
    // add dummy into committee to enable re-entry
    committee3AddressList.concat([dummy]),
    accountAlias
  );

  return [tx, jcEth];
};

const newTransferProposalContent = function (
  invalidAmount: boolean = false,
  deadline: number = 10000000000
): IProposalContent {
  return {
    accountNumber: 1,
    proposalType: ProposalType.Transfer,
    target: TRANSFER_RECEIVER.address,
    data: invalidAmount
      ? ethers.utils.defaultAbiCoder.encode(["uint256"], [0])
      : ethers.utils.defaultAbiCoder.encode(["uint256"], [TRANSFER_AMOUNT]),
    deadline: deadline,
  };
};

const newContractInteractionProposalContent = async function (
  dummy: DummyContract,
  deadline: number,
  reEntryAttack: boolean
): Promise<IProposalContent> {
  const DummyContract = await ethers.getContractFactory("DummyContract", {
    signer: committeeSigner,
    provider: provider,
  });

  if (reEntryAttack) {
    const data = ethers.utils.defaultAbiCoder.encode(
      ["uint64", "bytes"],
      [
        0,
        DummyContract.interface.encodeFunctionData("simulateReEntryAttack", []),
      ]
    );

    return {
      accountNumber: 1,
      proposalType: ProposalType.ContractInteraction,
      target: dummy.address,
      data: data,
      deadline: deadline,
    };
  } else {
    const data = ethers.utils.defaultAbiCoder.encode(
      ["uint64", "bytes"],
      [0, DummyContract.interface.encodeFunctionData("setCount", [newCount])]
    );

    return {
      accountNumber: 1,
      proposalType: ProposalType.ContractInteraction,
      target: dummy.address,
      data: data,
      deadline: deadline,
    };
  }
};

const newMultiCallProposalContent = async function (
  dummy: DummyContract,
  deadline: number,
  failMultiCall: boolean
): Promise<IProposalContent> {
  const DummyContract = await ethers.getContractFactory("DummyContract", {
    signer: committeeSigner,
    provider: provider,
  });

  const callDataArray = [];

  if (failMultiCall) {
    callDataArray.push(
      ethers.utils.defaultAbiCoder.encode(
        ["address", "bytes"],
        [
          dummy.address,
          DummyContract.interface.encodeFunctionData("willRevert", []),
        ]
      )
    );
  }

  for (let i = 0; i < MULTI_CALL_REPEAT_BUMP; i++) {
    callDataArray.push(
      ethers.utils.defaultAbiCoder.encode(
        ["address", "bytes"],
        [dummy.address, DummyContract.interface.encodeFunctionData("bump", [])]
      )
    );
  }

  const data = ethers.utils.defaultAbiCoder.encode(
    ["uint64", "bytes[]"],
    [3, callDataArray]
  );

  return {
    accountNumber: 1,
    proposalType: ProposalType.MultiCall,
    target: dummy.address,
    data: data,
    deadline: deadline,
  };
};

const newAccountAddressUpgradeContent = async function (
  newAccountAddress: string,
  deadline: number
): Promise<IProposalContent> {
  const DummyContract = await ethers.getContractFactory("DummyContract", {
    signer: committeeSigner,
    provider: provider,
  });

  return {
    accountNumber: 1,
    proposalType: ProposalType.AccounContractUpgrade,
    target: newAccountAddress,
    // random data
    data: DummyContract.interface.encodeFunctionData("setCount", [newCount]),
    deadline: deadline,
  };
};

const getPlaceholderFromAddress = async function (
  address: string
): Promise<JCETHPlaceholderBase> {
  const JCETHPlaceholderBase = await ethers.getContractFactory(
    "JCETHPlaceholderBase",
    {
      signer: committeeSigner,
      provider: provider,
    }
  );
  return JCETHPlaceholderBase.attach(address);
};

const proposeAndPollAndExeReady = async function (
  invalidAmount: boolean = false,
  type: ProposalType = ProposalType.Transfer,
  dummy?: DummyContract,
  deadline: number = 10000000000,
  reEntryAttack: boolean = false,
  voteMode: VoteMode = VoteMode.Majority,
  failMultiCall: boolean = false
): Promise<JointControlETHV1> {
  let jcEth;
  if (reEntryAttack) {
    [, jcEth] = await newAccountCommittee3WithDummy(dummy!.address, voteMode);
  } else {
    [, jcEth] = await newAccountCommittee3(voteMode);
  }

  const deadlineWithBase = (await provider.getBlockNumber()) + deadline;

  let proposalContent;
  if (type === ProposalType.Transfer) {
    proposalContent = newTransferProposalContent(
      invalidAmount,
      deadlineWithBase
    );
  } else if (type === ProposalType.ContractInteraction) {
    proposalContent = await newContractInteractionProposalContent(
      dummy!,
      deadlineWithBase,
      reEntryAttack
    );
  } else if (type === ProposalType.AccounContractUpgrade) {
    const JCETHPlaceholderTest = await ethers.getContractFactory(
      "JCETHPlaceholderTest",
      { signer: committeeSigner, provider: provider }
    );
    const newAccountContrat = await JCETHPlaceholderTest.deploy();

    proposalContent = await newAccountAddressUpgradeContent(
      newAccountContrat.address,
      deadlineWithBase
    );
  } else {
    proposalContent = await newMultiCallProposalContent(
      dummy!,
      deadlineWithBase,
      failMultiCall
    );
  }

  await jcEth.newProposal(proposalContent, true);

  // each member poll yah
  for (const member of committee3) {
    const jcEthMember = (
      await ethers.getContractFactory("JointControlETHV1", {
        signer: member,
        provider: provider,
      })
    ).attach(jcEth.address);

    const poll = {
      accountNumber: proposalContent.accountNumber,
      proposalNumber: 1,
      approval: true,
    };

    if (member === committeeSigner) {
      continue;
    } else {
      await jcEthMember.newPoll(poll);
    }
  }

  return jcEth;
};

describe("[JointControlETHV1] newAccount()", function () {
  it("Open new account successful", async function () {
    const [tx, jcEth] = await newAccountCommittee3();
    const receipt = await tx.wait();

    // check events //
    expect(receipt.events).to.be.an("array");
    expect(receipt.events!.length).to.equal(committee3.length + 3);
    const events = receipt.events!;

    // get new account events
    const newAccountEvents = events.filter((e) => e.event! === "NewAccount");

    const accountAddress = newAccountEvents[0].args!.accountAddress;
    for (let i = 0; i < newAccountEvents.length; i++) {
      const event = newAccountEvents[i];
      expect(event.args!.accountNumber, "account number").to.equal(1);
      expect(event.args!.founder).to.hexEqual(committeeSigner.address);
      expect(event.args!.member).to.hexEqual(committee3AddressList[i]);
      expect(event.args!.accountAlias).to.equal(accountAlias);
      expect(event.args!.numMembers, "numMembers event check").to.equal(
        committee3.length
      );
      expect(event.args!.voteMode, "mode").to.equal(VoteMode.Majority);
      expect(event.args!.accountAddress).to.hexEqual(accountAddress);

      // committee ownership
      expect(await jcEth.doesOwnAccount(committee3AddressList[i], 1)).to.equal(
        true
      );
    }

    // state check //

    // number account
    const numberAccount = await jcEth.totalAccounts();
    expect(numberAccount, "number accounts").to.equal(1);

    // account info
    const account = await jcEth.getAccount(1);
    expect(account.accountNumber, "account number").to.equal(1);
    expect(account.committee.length, "committee length").to.equal(
      committee3AddressList.length
    );
    for (let i = 0; i < account.committee.length; i++) {
      expect(account.committee[i]).to.hexEqual(committee3AddressList[i]);
    }
    expect(account.founder).to.hexEqual(committeeSigner.address);
    expect(account.voteMode, "mode").to.equal(VoteMode.Majority);
    expect(account.numProposals).to.equal(0);
    expect(account.accountAlias).to.equal(accountAlias);
    expect(account.accountAddress).to.hexEqual(accountAddress);

    // accountAddress info
    const placeholderContract = await getPlaceholderFromAddress(accountAddress);
    expect(await placeholderContract.accountNumber()).to.equal(
      account.accountNumber
    );
    expect(await placeholderContract.jcEth()).to.hexEqual(jcEth.address);

    // others don't have ownership
    expect(await jcEth.doesOwnAccount(nonCommitteeSigner.address, 1)).to.equal(
      false
    );
  });

  it("Revert with empty committee", async function () {
    const jcEth = await deployContract();

    await expect(
      jcEth.newAccount(VoteMode.Majority, [], accountAlias)
    ).to.revertedWith("empty committee");
  });
});

describe("[JointControlETHV1] newProposal()", function () {
  it("Submit a proposal successfully", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const proposalContent = newTransferProposalContent();

    const approval = getRandomInt(2) !== 0;
    const tx = await jcEth.newProposal(proposalContent, approval);
    const receipt = await tx.wait();

    // check event
    expect(receipt.events).to.be.an("array");
    expect(receipt.events![0].args!.accountNumber).to.equal(
      proposalContent.accountNumber
    );
    expect(receipt.events![0].args!.proposalNumber).to.equal(1);
    expect(receipt.events![0].args!.target).to.hexEqual(
      TRANSFER_RECEIVER.address
    );
    expect(receipt.events![0].args!.advocate).to.hexEqual(
      committeeSigner.address
    );
    expect(receipt.events![0].args!.approval).to.equal(approval);

    // state check

    // proposal counter
    const account = await jcEth.getAccount(1);
    expect(account.numProposals).to.equal(1);

    // proposal info
    const proposal = await jcEth.getProposal(1, 1);
    expect(proposal.proposalNumber).to.equal(1);
    expect(proposal.executed).to.equal(false);
    expect(proposal.yah).to.equal(approval ? 1 : 0);
    expect(proposal.nay).to.equal(approval ? 0 : 1);
    expect(proposal.advocate).to.hexEqual(committeeSigner.address);
    expect(proposal.content.accountNumber).to.equal(1);
    expect(proposal.content.proposalType).to.equal(
      proposalContent.proposalType
    );
    expect(proposal.content.target).to.hexEqual(proposalContent.target);
    expect(proposal.content.data).to.equal(proposalContent.data);
    expect(proposal.content.deadline).to.equal(proposalContent.deadline);

    // vote history
    for (const member of committee3) {
      const isVoted = await jcEth.getVoteHistory(member.address, 1, 1);
      if (member === committeeSigner) {
        expect(isVoted).to.equal(true);
      } else {
        expect(isVoted).to.equal(false);
      }
    }
  });

  it("memberCallSanityCheck: revert with non-existing account", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const proposalContent = newTransferProposalContent();

    // point to an invalid account
    proposalContent.accountNumber = 1999;

    await expect(jcEth.newProposal(proposalContent, true)).to.revertedWith(
      "Non-existing account"
    );
  });

  it("memberCallSanityCheck: non-committee member cannot call", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const proposalContent = newTransferProposalContent();

    // re-attach to non-committee singer
    const jcEthNonCommittee = (
      await ethers.getContractFactory("JointControlETHV1", {
        signer: nonCommitteeSigner,
        provider: provider,
      })
    ).attach(jcEth.address);

    await expect(
      jcEthNonCommittee.newProposal(proposalContent, true)
    ).to.revertedWith("Sender not in the committee");
  });
});

describe("[JointControlETHV1], newPoll()", function () {
  it("Poll successfully", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const proposalContent = newTransferProposalContent();

    const approval = getRandomInt(2) !== 0;
    await jcEth.newProposal(proposalContent, approval);

    let yah = approval ? 1 : 0;
    let nay = approval ? 0 : 1;

    // each member poll
    for (const member of committee3) {
      const jcEthMember = (
        await ethers.getContractFactory("JointControlETHV1", {
          signer: member,
          provider: provider,
        })
      ).attach(jcEth.address);

      const approval = getRandomInt(2) !== 0;
      const poll = {
        accountNumber: proposalContent.accountNumber,
        proposalNumber: 1,
        approval: approval,
      };

      if (member === committeeSigner) {
        // proposal member, revert with double voting
        await expect(jcEthMember.newPoll(poll)).to.revertedWith(
          "Double voting"
        );
      } else {
        const tx = await jcEthMember.newPoll(poll);
        const receipt = await tx.wait();

        // update voting
        yah += approval ? 1 : 0;
        nay += approval ? 0 : 1;

        // check event
        expect(receipt.events).to.be.an("array");
        expect(receipt.events![0].args!.accountNumber).to.equal(1);
        expect(receipt.events![0].args!.proposalNumber).to.equal(1);
        expect(receipt.events![0].args!.approval).to.equal(approval);
        expect(receipt.events![0].args!.member).to.hexEqual(member.address);

        // state change

        // proposal voting info
        const proposal = await jcEth.getProposal(1, 1);
        expect(proposal.proposalNumber).to.equal(1);
        expect(proposal.executed).to.equal(false);
        expect(proposal.yah).to.equal(yah);
        expect(proposal.nay).to.equal(nay);

        // vote history
        expect(await jcEth.getVoteHistory(member.address, 1, 1)).to.equal(true);
      }
    }
  });

  it("Poll failed due to double voting", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const proposalContent = newTransferProposalContent();

    const approval = getRandomInt(2) !== 0;
    await jcEth.newProposal(proposalContent, approval);

    // each member poll
    for (const member of committee3) {
      const jcEthMember = (
        await ethers.getContractFactory("JointControlETHV1", {
          signer: member,
          provider: provider,
        })
      ).attach(jcEth.address);

      const approval = getRandomInt(2) !== 0;
      const poll = {
        accountNumber: proposalContent.accountNumber,
        proposalNumber: 1,
        approval: approval,
      };

      if (member === committeeSigner) {
        // proposal member, revert with double voting
        await expect(jcEthMember.newPoll(poll)).to.revertedWith(
          "Double voting"
        );
      } else {
        await jcEthMember.newPoll(poll);
      }
    }

    // each member poll again, double voting
    for (const member of committee3) {
      const jcEthMember = (
        await ethers.getContractFactory("JointControlETHV1", {
          signer: member,
          provider: provider,
        })
      ).attach(jcEth.address);

      const approval = getRandomInt(2) !== 0;
      const poll = {
        accountNumber: proposalContent.accountNumber,
        proposalNumber: 1,
        approval: approval,
      };

      await expect(jcEthMember.newPoll(poll)).to.revertedWith("Double voting");
    }
  });

  it("memberCallSanityCheck: revert with non-existing account", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const proposalContent = newTransferProposalContent();

    const approval = getRandomInt(2) !== 0;
    await jcEth.newProposal(proposalContent, approval);

    const poll = {
      accountNumber: 1999,
      proposalNumber: 1,
      approval: approval,
    };

    await expect(jcEth.newPoll(poll)).to.revertedWith("Non-existing account");
  });

  it("memberCallSanityCheck: non-committee member cannot call", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const proposalContent = newTransferProposalContent();

    const approval = getRandomInt(2) !== 0;
    await jcEth.newProposal(proposalContent, approval);

    // re-attach to non-committee singer
    const jcEthNonCommittee = (
      await ethers.getContractFactory("JointControlETHV1", {
        signer: nonCommitteeSigner,
        provider: provider,
      })
    ).attach(jcEth.address);

    const poll = {
      accountNumber: 1,
      proposalNumber: 1,
      approval: approval,
    };

    await expect(jcEthNonCommittee.newPoll(poll)).to.revertedWith(
      "Sender not in the committee"
    );
  });

  it("proposalSanityCheck: revert with non-existing proposal", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const proposalContent = newTransferProposalContent();

    const approval = getRandomInt(2) !== 0;
    await jcEth.newProposal(proposalContent, approval);

    const poll = {
      accountNumber: 1,
      proposalNumber: 1999,
      approval: approval,
    };

    await expect(jcEth.newPoll(poll)).to.revertedWith("Non-existing proposal");
  });

  it("proposalSanityCheck: revert when pass deadline", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const proposalContent = newTransferProposalContent();

    // set a tight deadline
    proposalContent.deadline = ethers.getDefaultProvider().blockNumber + 1;

    const approval = getRandomInt(2) !== 0;
    await jcEth.newProposal(proposalContent, approval);

    // pass some blocks
    for (let i = 0; i < 5; i++) {
      await newAccountCommittee3();
    }

    const poll = {
      accountNumber: 1,
      proposalNumber: 1,
      approval: approval,
    };

    await expect(jcEth.newPoll(poll)).to.revertedWith("Poll passing deadline");
  });

  it("proposalSanityCheck: revert when proposal has been executed already", async function () {
    const [, jcEth] = await newAccountCommittee3();
    const proposalContent = newTransferProposalContent();

    await jcEth.newProposal(proposalContent, true);

    // deposit some ETH to account
    await jcEth.depositETH(1, { value: ethers.utils.parseEther("1.0") });

    // each member poll yah
    for (const member of committee3) {
      const jcEthMember = (
        await ethers.getContractFactory("JointControlETHV1", {
          signer: member,
          provider: provider,
        })
      ).attach(jcEth.address);

      const poll = {
        accountNumber: proposalContent.accountNumber,
        proposalNumber: 1,
        approval: true,
      };

      if (member === committeeSigner) {
        // proposal member, revert with double voting
        await expect(jcEthMember.newPoll(poll)).to.revertedWith(
          "Double voting"
        );
      } else {
        await jcEthMember.newPoll(poll);
      }
    }

    // execute
    const exeRequest = {
      accountNumber: 1,
      proposalNumber: 1,
    };
    await jcEth.execute(exeRequest, { gasLimit: "2000000" });

    // poll again, should revert
    for (const member of committee3) {
      const jcEthMember = (
        await ethers.getContractFactory("JointControlETHV1", {
          signer: member,
          provider: provider,
        })
      ).attach(jcEth.address);

      const poll = {
        accountNumber: proposalContent.accountNumber,
        proposalNumber: 1,
        approval: true,
      };

      await expect(jcEthMember.newPoll(poll)).to.revertedWith(
        "Proposal executed"
      );
    }
  });
});

describe("[JointControlETHV1], execute()", function () {
  it("Execute transfer successfully", async function () {
    const jcEth = await proposeAndPollAndExeReady();

    // deposit some ETH to account
    await jcEth.depositETH(1, {
      value: ethers.utils.parseEther("1.0"),
      gasLimit: "800000",
    });

    // get pre-exe balance
    const receiverBalanceBefore = await TRANSFER_RECEIVER.getBalance();
    const accountBalanceBefore = await jcEth.getBalance(1);

    const request = {
      accountNumber: 1,
      proposalNumber: 1,
    };

    const tx = await jcEth.execute(request);
    const receipt = await tx.wait();

    const proposal = await jcEth.getProposal(1, 1);

    // check event
    expect(receipt.events).to.be.an("array");
    expect(receipt.events![0].args!.accountNumber).to.be.equal(
      proposal.content.accountNumber
    );
    expect(receipt.events![0].args!.proposalNumber).to.be.equal(
      proposal.proposalNumber
    );
    expect(receipt.events![0].args!.proposalType).to.be.equal(
      proposal.content.proposalType
    );
    expect(receipt.events![0].args!.executor).to.be.hexEqual(
      committeeSigner.address
    );
    expect(receipt.events![0].args!.target).to.be.equal(
      proposal.content.target
    );

    // state check
    expect(proposal.executed).to.equal(true);

    // transfer result check
    expect(await TRANSFER_RECEIVER.getBalance()).to.equal(
      receiverBalanceBefore.add(TRANSFER_AMOUNT)
    );
    expect(await jcEth.getBalance(1)).to.equal(
      accountBalanceBefore.sub(TRANSFER_AMOUNT)
    );
  });

  it("memberCallSanityCheck: revert with non-existing account", async function () {
    const jcEth = await proposeAndPollAndExeReady();

    const request = {
      accountNumber: 1999,
      proposalNumber: 1,
    };

    await expect(jcEth.execute(request)).to.revertedWith(
      "Non-existing account"
    );
  });

  it("memberCallSanityCheck: non-committee member cannot call", async function () {
    const jcEth = await proposeAndPollAndExeReady();

    const request = {
      accountNumber: 1,
      proposalNumber: 1,
    };

    // re-attach to non-committee singer
    const jcEthNonCommittee = (
      await ethers.getContractFactory("JointControlETHV1", {
        signer: nonCommitteeSigner,
        provider: provider,
      })
    ).attach(jcEth.address);

    await expect(jcEthNonCommittee.execute(request)).to.revertedWith(
      "Sender not in the committee"
    );
  });

  it("proposalSanityCheck: revert with non-existing proposal", async function () {
    const jcEth = await proposeAndPollAndExeReady();

    const request = {
      accountNumber: 1,
      proposalNumber: 1999,
    };

    await expect(jcEth.execute(request)).to.revertedWith(
      "Non-existing proposal"
    );
  });

  it("proposalSanityCheck: revert when pass deadline", async function () {
    const jcEth = await proposeAndPollAndExeReady(
      false,
      ProposalType.Transfer,
      undefined,
      100 // tight deadline
    );

    // pass blocks
    const dummy = await deployDummyContract();
    for (let i = 0; i < 120; i++) {
      const tx = await dummy.setCount(i);
      await tx.wait();
    }

    const request = {
      accountNumber: 1,
      proposalNumber: 1,
    };

    await expect(jcEth.execute(request)).to.revertedWith(
      "Poll passing deadline"
    );
  });

  it("proposalSanityCheck: revert when proposal has been executed already", async function () {});

  it("Transfer failed due to not enough balance", async function () {
    const jcEth = await proposeAndPollAndExeReady();

    // deposit 1 wei
    await jcEth.depositETH(1, { value: ethers.utils.parseUnits("1.0", "wei") });

    const request = {
      accountNumber: 1,
      proposalNumber: 1,
    };

    await expect(jcEth.execute(request)).to.revertedWith("Not enough balance");
  });

  it("Transfer failed due to not invalid transfer amount", async function () {
    const jcEth = await proposeAndPollAndExeReady(true);

    // deposit 1 wei
    await jcEth.depositETH(1, {
      value: ethers.utils.parseUnits("1.0", "ether"),
    });

    const request = {
      accountNumber: 1,
      proposalNumber: 1,
    };

    await expect(jcEth.execute(request)).to.revertedWith(
      "Invalid transfer amount"
    );
  });

  it("Execute contract interaction successfully", async function () {
    const dummy = await deployDummyContract();
    const jcEth = await proposeAndPollAndExeReady(
      false,
      ProposalType.ContractInteraction,
      dummy
    );

    const request = {
      accountNumber: 1,
      proposalNumber: 1,
    };
    const tx = await jcEth.execute(request);
    const receipt = await tx.wait();

    const proposal = await jcEth.getProposal(1, 1);

    // check event
    expect(receipt.events!).to.be.an("array");
    expect(receipt.events![0].args!.accountNumber).to.eq(
      proposal.content.accountNumber
    );
    expect(receipt.events![0].args!.proposalNumber).to.eq(
      proposal.proposalNumber
    );
    expect(receipt.events![0].args!.proposalType).to.eq(
      proposal.content.proposalType
    );
    expect(receipt.events![0].args!.executor).to.hexEqual(
      committeeSigner.address
    );
    expect(receipt.events![0].args!.target).to.hexEqual(
      proposal.content.target
    );

    // state check
    expect(proposal.executed).to.equal(true);

    // dummy state changed
    expect(await dummy.getCount()).to.equal(newCount);
  });

  it("Execute account address upgrading", async function () {
    const jcEth = await proposeAndPollAndExeReady(
      false,
      ProposalType.AccounContractUpgrade
    );

    // before execute
    const accountAddressPreExe = (await jcEth.getAccount(1)).accountAddress;

    const request = {
      accountNumber: 1,
      proposalNumber: 1,
    };
    const tx = await jcEth.execute(request);
    const receipt = await tx.wait();

    const proposal = await jcEth.getProposal(1, 1);

    // check state //

    expect(proposal.executed).to.equal(true);

    const accountAddressPostExe = (await jcEth.getAccount(1)).accountAddress;
    expect(accountAddressPostExe).to.hexEqual(accountAddressPreExe);

    const JCETHPlaceholderTest = await ethers.getContractFactory(
      "JCETHPlaceholderTest",
      { signer: committeeSigner, provider: provider }
    );
    const placeholderTest = JCETHPlaceholderTest.attach(accountAddressPostExe);
    expect(await placeholderTest.getCount()).to.equal(33);
  });

  it("Execute multi call", async function () {
    const dummy = await deployDummyContract();
    const jcEth = await proposeAndPollAndExeReady(
      false,
      ProposalType.MultiCall,
      dummy
    );

    const request = {
      accountNumber: 1,
      proposalNumber: 1,
    };
    const tx = await jcEth.execute(request);

    expect(await dummy.getCount()).to.equal(MULTI_CALL_REPEAT_BUMP);
  });

  it("Execute multi call fail", async function () {
    const dummy = await deployDummyContract();
    const jcEth = await proposeAndPollAndExeReady(
      false,
      ProposalType.MultiCall,
      dummy,
      10000000,
      false,
      VoteMode.Majority,
      true
    );

    const request = {
      accountNumber: 1,
      proposalNumber: 1,
    };

    await expect(jcEth.execute(request)).to.revertedWith("revert");

    expect(await dummy.getCount()).to.equal(0);
  });

  it("Voting mode", async function () {
    const flow = async function (voteMode: VoteMode) {
      for (let n = 1; n < UNSAFE_ACCOUNTS.length; n++) {
        let majorityThreshold;
        if (voteMode === VoteMode.Majority) {
          majorityThreshold = Math.ceil((n * 2) / 3);
        } else {
          majorityThreshold = n;
        }

        const [, jcEth] = await newAccountCommitteeN(n, voteMode);

        // check threshold
        expect(await jcEth.getAccountMajorityThreshold(1)).to.equal(
          majorityThreshold
        );

        // send some ETH to account
        await jcEth.depositETH(1, { value: ethers.utils.parseEther("1") });

        const deadlineWithBase = (await provider.getBlockNumber()) + 1000;
        const proposalContent = newTransferProposalContent(
          false,
          deadlineWithBase
        );

        await jcEth.newProposal(proposalContent, true);

        let yah = 1; // 1 cause proposal with an yah
        let executed = false;
        for (const member of UNSAFE_ACCOUNTS.slice(0, n)) {
          const jcEthMember = (
            await ethers.getContractFactory("JointControlETHV1", {
              signer: member,
              provider: provider,
            })
          ).attach(jcEth.address);

          const poll = {
            accountNumber: proposalContent.accountNumber,
            proposalNumber: 1,
            approval: true, // each member poll yah
          };

          if (member !== committeeSigner) {
            if (yah < majorityThreshold) {
              await jcEthMember.newPoll(poll);
              yah += 1;
            } else {
              // cannot poll on executed one
              await expect(jcEthMember.newPoll(poll)).to.revertedWith(
                "Proposal executed"
              );
            }
          }

          // execute check
          const request = {
            accountNumber: 1,
            proposalNumber: 1,
          };
          if (yah < majorityThreshold) {
            // not enough vote
            await expect(jcEthMember.execute(request)).to.revertedWith(
              "Not enough yah"
            );
          } else {
            // enough vote
            if (!executed) {
              await jcEthMember.execute(request);
              executed = true;
            } else {
              await expect(jcEthMember.execute(request)).to.revertedWith(
                "Proposal executed"
              );
            }
          }
        }
      }
    };

    for (const voteMode of [VoteMode.Majority, VoteMode.Omni]) {
      await flow(voteMode);
    }
  });

  it("re-entry attack", async function () {
    const dummy = await deployDummyContract();

    const jcEth = await proposeAndPollAndExeReady(
      false,
      ProposalType.ContractInteraction,
      dummy,
      10000,
      true
    );

    // info needed to re-entry attack
    await dummy.setAccountNumber(1);
    await dummy.setProposalNumber(1);
    await dummy.setJcEth(jcEth.address);

    const request = {
      accountNumber: 1,
      proposalNumber: 1,
    };
    await expect(jcEth.execute(request)).to.revertedWith("re-Entry");

    // state check

    // proposal not executed successfully
    const proposal = await jcEth.getProposal(1, 1);
    expect(proposal.executed).to.equal(false);

    // dummy state not changed
    expect(await dummy.getCount()).to.equal(0);
  });
});

describe("[JointControlETHV1] account proxy contract", () => {
  it("Revert with re-initialize", async () => {
    const dummy = await deployDummyContract();
    const jcEth = await proposeAndPollAndExeReady(
      false,
      ProposalType.ContractInteraction,
      dummy
    );

    const account = await jcEth.getAccount(1);
    const accountAddress = account.accountAddress;
    const JCETHPlaceholderBase = await ethers.getContractFactory(
      "JCETHPlaceholderBase",
      {
        signer: committeeSigner,
        provider: provider,
      }
    );

    const proxy = JCETHPlaceholderBase.attach(accountAddress);

    await expect(proxy.initialize(committeeSigner.address, 2)).to.revertedWith(
      "Initializable: contract is already initialized"
    );
  });
});
