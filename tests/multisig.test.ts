import {
  Cl,
  getAddressFromPrivateKey,
  makeRandomPrivKey,
  signMessageHashRsv,
} from "@stacks/transactions";
import { assert, beforeEach, describe, expect, it } from "vitest";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;

// Create 3 random private keys for Alice, Bob, and Charlie
const alicePrivateKey = makeRandomPrivKey();
const bobPrivateKey = makeRandomPrivKey();
const charliePrivateKey = makeRandomPrivKey();

// Get the addresses from the private keys
const alice = getAddressFromPrivateKey(alicePrivateKey, "mocknet");
const bob = getAddressFromPrivateKey(bobPrivateKey, "mocknet");
const charlie = getAddressFromPrivateKey(charliePrivateKey, "mocknet");

// Get the contract principals for the token and multisig contracts
const token = Cl.contractPrincipal(deployer, "mock-token");
const multisig = Cl.contractPrincipal(deployer, "multisig");

describe("Multisig Tests", () => {
  beforeEach(() => {
    const allAccounts = [alice, bob, charlie];

    for (const account of allAccounts) {
      const mintResultOne = simnet.callPublicFn(
        "mock-token",
        "mint",
        [Cl.uint(1_000_000_000), Cl.principal(account)],
        account
      );

      expect(mintResultOne.events.length).toBeGreaterThan(0);

      simnet.mintSTX(account, 100_000_000n);
    }
  });

  it("allows initializing the multisig", () => {
    const initializeResult = simnet.callPublicFn(
      "multisig",
      "initialize",
      [
        Cl.list([
          Cl.principal(alice),
          Cl.principal(bob),
          Cl.principal(charlie),
        ]),
        Cl.uint(2),
      ],
      deployer
    );

    expect(initializeResult.result).toStrictEqual(Cl.ok(Cl.bool(true)));

    const signers = simnet.getDataVar("multisig", "signers");
    expect(signers).toEqual(
      Cl.list([Cl.principal(alice), Cl.principal(bob), Cl.principal(charlie)])
    );

    const threshold = simnet.getDataVar("multisig", "threshold");
    expect(threshold).toEqual(Cl.uint(2));

    const initialized = simnet.getDataVar("multisig", "initialized");
    expect(initialized).toEqual(Cl.bool(true));
  });

  it("only allows deployer to initialize the multisig", () => {
    const initializeResult = simnet.callPublicFn(
      "multisig",
      "initialize",
      [
        Cl.list([
          Cl.principal(alice),
          Cl.principal(bob),
          Cl.principal(charlie),
        ]),
        Cl.uint(2),
      ],
      alice
    );

    expect(initializeResult.result).toStrictEqual(Cl.error(Cl.uint(500)));
  });

  it("does not allow initializing the multisig if it is already initialized", () => {
    const initializeResult = simnet.callPublicFn(
      "multisig",
      "initialize",
      [
        Cl.list([
          Cl.principal(alice),
          Cl.principal(bob),
          Cl.principal(charlie),
        ]),
        Cl.uint(2),
      ],
      deployer
    );

    expect(initializeResult.result).toStrictEqual(Cl.ok(Cl.bool(true)));

    const initializeResultTwo = simnet.callPublicFn(
      "multisig",
      "initialize",
      [
        Cl.list([
          Cl.principal(alice),
          Cl.principal(bob),
          Cl.principal(charlie),
        ]),
        Cl.uint(2),
      ],
      deployer
    );

    expect(initializeResultTwo.result).toStrictEqual(Cl.error(Cl.uint(501)));
  });

  it("does not allow initializing the multisig if the threshold is too low", () => {
    const initializeResult = simnet.callPublicFn(
      "multisig",
      "initialize",
      [
        Cl.list([
          Cl.principal(alice),
          Cl.principal(bob),
          Cl.principal(charlie),
        ]),
        Cl.uint(0),
      ],
      deployer
    );

    expect(initializeResult.result).toStrictEqual(Cl.error(Cl.uint(509)));
  });

  it("allows any of the signers to submit a transaction", () => {
    const initializeResult = simnet.callPublicFn(
      "multisig",
      "initialize",
      [
        Cl.list([
          Cl.principal(alice),
          Cl.principal(bob),
          Cl.principal(charlie),
        ]),
        Cl.uint(2),
      ],
      deployer
    );

    expect(initializeResult.result).toStrictEqual(Cl.ok(Cl.bool(true)));

    for (const signer of [alice, bob, charlie]) {
      const expectedTxnId = simnet.getDataVar("multisig", "txn-id");
      const submitResult = simnet.callPublicFn(
        "multisig",
        "submit-txn",
        [Cl.uint(0), Cl.uint(100), Cl.principal(signer), Cl.none()],
        signer
      );

      expect(submitResult.result).toStrictEqual(Cl.ok(expectedTxnId));
    }
  });

  it("does not allow a non-signer to submit a transaction", () => {
    const initializeResult = simnet.callPublicFn(
      "multisig",
      "initialize",
      [
        Cl.list([
          Cl.principal(alice),
          Cl.principal(bob),
          Cl.principal(charlie),
        ]),
        Cl.uint(2),
      ],
      deployer
    );

    expect(initializeResult.result).toStrictEqual(Cl.ok(Cl.bool(true)));

    const submitResult = simnet.callPublicFn(
      "multisig",
      "submit-txn",
      [Cl.uint(0), Cl.uint(100), Cl.principal(alice), Cl.none()],
      deployer
    );

    expect(submitResult.result).toStrictEqual(Cl.error(Cl.uint(504)));
  });

  it("can submit a STX transfer transaction", () => {
    // Initialize the multisig
    const initializeResult = simnet.callPublicFn(
      "multisig",
      "initialize",
      [
        Cl.list([
          Cl.principal(alice),
          Cl.principal(bob),
          Cl.principal(charlie),
        ]),
        Cl.uint(2),
      ],
      deployer
    );
    expect(initializeResult.result).toStrictEqual(Cl.ok(Cl.bool(true)));

    // Submit a transaction
    const submitResult = simnet.callPublicFn(
      "multisig",
      "submit-txn",
      [Cl.uint(0), Cl.uint(100), Cl.principal(alice), Cl.none()],
      alice
    );
    expect(submitResult.result).toStrictEqual(Cl.ok(Cl.uint(0)));

    // Send money to the multisig so it has STX tokens to transfer later
    // when the txn is executed
    const transferResult = simnet.transferSTX(
      100,
      multisig.value.toString(),
      alice
    );
    expect(transferResult.result).toStrictEqual(Cl.ok(Cl.bool(true)));

    // Hash the transaction
    const txnHash = simnet.callReadOnlyFn(
      "multisig",
      "hash-txn",
      [Cl.uint(0)],
      deployer
    );
    assert(txnHash.result.type === "buffer");

    // Have each signer sign the transaction
    const aliceSignature = signMessageHashRsv({
      messageHash: txnHash.result.value,
      privateKey: alicePrivateKey,
    });
    const bobSignature = signMessageHashRsv({
      messageHash: txnHash.result.value,
      privateKey: bobPrivateKey,
    });

    // Execute the transaction
    const executeResult = simnet.callPublicFn(
      "multisig",
      "execute-stx-transfer-txn",
      [
        Cl.uint(0),
        Cl.list([
          Cl.bufferFromHex(aliceSignature),
          Cl.bufferFromHex(bobSignature),
        ]),
      ],
      alice
    );
    expect(executeResult.result).toStrictEqual(Cl.ok(Cl.bool(true)));
    expect(executeResult.events.length).toEqual(2); // one stx_transfer and one print
  });

  it("can submit a SIP-010 transfer transaction", () => {
    const initializeResult = simnet.callPublicFn(
      "multisig",
      "initialize",
      [
        Cl.list([
          Cl.principal(alice),
          Cl.principal(bob),
          Cl.principal(charlie),
        ]),
        Cl.uint(2),
      ],
      deployer
    );

    expect(initializeResult.result).toStrictEqual(Cl.ok(Cl.bool(true)));

    const submitResult = simnet.callPublicFn(
      "multisig",
      "submit-txn",
      [Cl.uint(1), Cl.uint(100), Cl.principal(alice), Cl.some(token)],
      alice
    );

    expect(submitResult.result).toStrictEqual(Cl.ok(Cl.uint(0)));

    // send some token to the multisig
    const sendResult = simnet.callPublicFn(
      "mock-token",
      "transfer",
      [Cl.uint(100), Cl.principal(alice), multisig, Cl.none()],
      alice
    );
    expect(sendResult.result).toStrictEqual(Cl.ok(Cl.bool(true)));

    const balance = simnet.callReadOnlyFn(
      "mock-token",
      "get-balance",
      [multisig],
      deployer
    );
    expect(balance.result).toStrictEqual(Cl.ok(Cl.uint(100)));

    const txnHash = simnet.callReadOnlyFn(
      "multisig",
      "hash-txn",
      [Cl.uint(0)],
      deployer
    );
    assert(txnHash.result.type === "buffer");

    const aliceSignature = signMessageHashRsv({
      messageHash: txnHash.result.value,
      privateKey: alicePrivateKey,
    });
    const bobSignature = signMessageHashRsv({
      messageHash: txnHash.result.value,
      privateKey: bobPrivateKey,
    });

    const executeResult = simnet.callPublicFn(
      "multisig",
      "execute-token-transfer-txn",
      [
        Cl.uint(0),
        token,
        Cl.list([
          Cl.bufferFromHex(aliceSignature),
          Cl.bufferFromHex(bobSignature),
        ]),
      ],
      alice
    );
    expect(executeResult.result).toStrictEqual(Cl.ok(Cl.bool(true)));
    expect(executeResult.events.length).toEqual(2); // one ft_transfer and one print

    const newBalance = simnet.callReadOnlyFn(
      "mock-token",
      "get-balance",
      [multisig],
      deployer
    );
    expect(newBalance.result).toStrictEqual(Cl.ok(Cl.uint(0)));
  });
});
