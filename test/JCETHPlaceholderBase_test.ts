import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import {
  JCETHPlaceholderBase,
  DummyContract,
  DummyContract__factory,
} from "../typechain";
import { UNSAFE_ACCOUNTS, getRandomInt } from "./util";

// Committee signer, 1st account
const committeeSigner = UNSAFE_ACCOUNTS[0];

const provider = waffle.provider;

const newCount = getRandomInt(1000000);

const deployContract = async function (): Promise<JCETHPlaceholderBase> {
  const JCETHPlaceholderBase = await ethers.getContractFactory(
    "JCETHPlaceholderBase",
    {
      signer: committeeSigner,
      provider: provider,
    }
  );
  const holder = await JCETHPlaceholderBase.deploy();
  await holder.initialize(committeeSigner.address, 1);

  return holder;
};

const deployDummyContract = async function (): Promise<
  [DummyContract, DummyContract__factory]
> {
  const DummyContract = await ethers.getContractFactory("DummyContract", {
    signer: committeeSigner,
    provider: provider,
  });
  return [await DummyContract.deploy(), DummyContract];
};

describe("[JCETHPlaceholderBase] deploy", function () {
  it("deploy normally", async function () {
    const placeholder = await deployContract();

    // check state
    expect(await placeholder.jcEth()).to.hexEqual(committeeSigner.address);
    expect(await placeholder.accountNumber()).to.equal(1);
  });
});

describe("[JCETHPlaceholderBase] jcEthOnly interaction", function () {
  it("jcEth can access _call()", async function () {
    // dummy call
    const [dummy, DummyContract] = await deployDummyContract();
    const data = DummyContract.interface.encodeFunctionData("setCount", [
      newCount,
    ]);

    const placeholder = await deployContract();
    await placeholder._call(dummy.address, data);

    // check state
    expect(await dummy.getCount()).to.equal(newCount);
  });

  it("jcEth can access _transfer()", async function () {
    const placeholder = await deployContract();

    // deposit some eth to placeholder
    await committeeSigner.sendTransaction({
      to: placeholder.address,
      value: ethers.utils.parseEther("1.0"),
    });

    const preSendBalanceReceiver = await UNSAFE_ACCOUNTS[1].getBalance();
    const preSendBalanceContract = await provider.getBalance(
      placeholder.address
    );

    await placeholder._transfer(
      UNSAFE_ACCOUNTS[1].address,
      ethers.utils.parseEther("0.5")
    );

    // check state

    const postSendBalanceReceiver = await UNSAFE_ACCOUNTS[1].getBalance();
    expect(postSendBalanceReceiver).to.equal(
      preSendBalanceReceiver.add(ethers.utils.parseEther("0.5"))
    );

    const postSendBalanceContract = await provider.getBalance(
      placeholder.address
    );
    expect(postSendBalanceContract).to.equal(
      preSendBalanceContract.sub(ethers.utils.parseEther("0.5"))
    );
  });

  it("_transfer() fails on over-drafting", async function () {
    const placeholder = await deployContract();

    // deposit some eth to placeholder
    await committeeSigner.sendTransaction({
      to: placeholder.address,
      value: ethers.utils.parseEther("1.0"),
    });

    const preSendBalanceReceiver = await UNSAFE_ACCOUNTS[1].getBalance();
    const preSendBalance = await provider.getBalance(placeholder.address);

    // send a big amount
    await placeholder._transfer(
      UNSAFE_ACCOUNTS[1].address,
      ethers.utils.parseEther("10000000")
    );

    // check state
    // contract should have failed to send ETH. Thus, all balances shouldn't change

    const postSendBalanceReceiver = await UNSAFE_ACCOUNTS[1].getBalance();
    expect(postSendBalanceReceiver).to.equal(preSendBalanceReceiver);

    const postSendBalance = await provider.getBalance(placeholder.address);
    expect(postSendBalance).to.equal(preSendBalance);
  });

  it("_call() cannot do self-call", async function () {
    const placeholder = await deployContract();

    // deposit some eth to placeholder
    await committeeSigner.sendTransaction({
      to: placeholder.address,
      value: ethers.utils.parseEther("1.0"),
    });

    //  call setup
    const JCETHPlaceholderBase = await ethers.getContractFactory(
      "JCETHPlaceholderBase",
      {
        signer: committeeSigner,
        provider: provider,
      }
    );
    // the call data is trying to transfer 0.5 ETH to UNSAFE_ACCOUNTS[1]
    const data = JCETHPlaceholderBase.interface.encodeFunctionData(
      "_transfer",
      [UNSAFE_ACCOUNTS[1].address, ethers.utils.parseEther("0.5")]
    );

    const preSendBalanceReceiver = await UNSAFE_ACCOUNTS[1].getBalance();
    const preSendBalance = await provider.getBalance(placeholder.address);

    // This will not revert cause `call()` will just return `false`
    await placeholder._call(placeholder.address, data);

    // check state
    // contract should have failed to call. Thus, all balances shouldn't change

    const postSendBalanceReceiver = await UNSAFE_ACCOUNTS[1].getBalance();
    expect(postSendBalanceReceiver).to.equal(preSendBalanceReceiver);

    const postSendBalance = await provider.getBalance(placeholder.address);
    expect(postSendBalance).to.equal(preSendBalance);
  });

  it("non-jcEth signer cannot access _call()", async function () {
    // dummy call
    const [dummy, DummyContract] = await deployDummyContract();
    const oldCount = await dummy.getCount();
    const data = DummyContract.interface.encodeFunctionData("setCount", [
      newCount,
    ]);

    const placeholder = await deployContract();

    // non-jceth signer
    const JCETHPlaceholderBaseNonAccessSigner = await ethers.getContractFactory(
      "JCETHPlaceholderBase",
      {
        signer: UNSAFE_ACCOUNTS[1],
        provider: provider,
      }
    );
    const placeholderNonAccess = JCETHPlaceholderBaseNonAccessSigner.attach(
      placeholder.address
    );

    await expect(
      placeholderNonAccess._call(dummy.address, data)
    ).to.revertedWith("Un-authorized call");

    // check state

    // dummy contract didn't updated
    expect(await dummy.getCount()).to.equal(oldCount);
  });

  it("non-jcEth signer cannot access _transfer()", async function () {
    const placeholder = await deployContract();

    // deposit some eth to placeholder
    await committeeSigner.sendTransaction({
      to: placeholder.address,
      value: ethers.utils.parseEther("1.0"),
    });

    const preSendBalanceReceiver = await UNSAFE_ACCOUNTS[1].getBalance();
    const preSendBalance = await provider.getBalance(placeholder.address);

    // non-jceth signer
    const JCETHPlaceholderBaseNonAccessSigner = await ethers.getContractFactory(
      "JCETHPlaceholderBase",
      {
        signer: UNSAFE_ACCOUNTS[2], // if use 1, there will be gas consumption. cannot compare later
        provider: provider,
      }
    );
    const placeholderNonAccess = JCETHPlaceholderBaseNonAccessSigner.attach(
      placeholder.address
    );

    // try transfer
    await expect(
      placeholderNonAccess._transfer(
        UNSAFE_ACCOUNTS[1].address,
        ethers.utils.parseEther("0.5")
      )
    ).to.revertedWith("Un-authorized call");

    // check state
    // contract should have failed to send ETH. Thus, all balances shouldn't change

    const postSendBalanceReceiver = await UNSAFE_ACCOUNTS[1].getBalance();
    expect(postSendBalanceReceiver).to.equal(preSendBalanceReceiver);

    const postSendBalance = await provider.getBalance(placeholder.address);
    expect(postSendBalance).to.equal(preSendBalance);
  });
});
