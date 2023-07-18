import * as dotenv from "dotenv";
dotenv.config();

import {
	SimpleAccountFactory__factory,
	EntryPoint__factory,
	SimpleAccount__factory,
	EntryPoint,
	UserOperationStruct,
} from "@account-abstraction/contracts";
import { ethers, BigNumber, Wallet } from "ethers";
import {
	getERC20Paymaster,
	ERC20,
	ERC20__factory,
} from "@pimlico/erc20-paymaster";

// Generate the INIT CODE
const SIMPLE_ACCOUNT_FACTORY_ADDRESS =
	"0x9406Cc6185a346906296840746125a0E44976454";
const ENTRY_POINT_ADDRESS = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

// GENERATE THE CALLDATA
const to = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik
const value = 0;
const data = "0x68656c6c6f"; // "hello" encoded to utf-8 bytes

const lineaProvider = new ethers.providers.StaticJsonRpcProvider(
	"https://rpc.goerli.linea.build/"
);
const gasPrice = await lineaProvider.getGasPrice();
const owner = Wallet.createRandom();
console.log("Generated owner with private key: ", owner.privateKey);

// REQUEST PIMLICO VERIFYING PAYMASTER SPONSORSHIP
const chain = "linea-testnet"; // find the list of chain names on the Pimlico verifying paymaster reference page
const apiKey = process.env.PIMLICO_API_KEY;

const pimlicoEndpoint = `https://api.pimlico.io/v1/${chain}/rpc?apikey=${apiKey}`;
const pimlicoProvider = new ethers.providers.StaticJsonRpcProvider(
	pimlicoEndpoint
);

const simpleAccountFactory = SimpleAccountFactory__factory.connect(
	SIMPLE_ACCOUNT_FACTORY_ADDRESS,
	lineaProvider
);

const entryPoint = EntryPoint__factory.connect(
	ENTRY_POINT_ADDRESS,
	lineaProvider
);

const initCode = ethers.utils.hexConcat([
	SIMPLE_ACCOUNT_FACTORY_ADDRESS,
	simpleAccountFactory.interface.encodeFunctionData("createAccount", [
		owner.address,
		0,
	]),
]);
console.log("Generated Init Code: ", initCode);

const senderAddress = await entryPoint.callStatic
	.getSenderAddress(initCode)
	.then(() => {
		throw new Error("Expected getSenderAddress() to revert");
	})
	.catch((e) => {
		const data = e.message.match(/0x6ca7b806([a-fA-F\d]*)/)?.[1];
		if (!data) {
			return Promise.reject(new Error("Failed to parse revert data"));
		}
		const addr = ethers.utils.getAddress(`0x${data.slice(24, 64)}`);
		return Promise.resolve(addr);
	});
console.log("Calculated sender address:", senderAddress);

const simpleAccount = SimpleAccount__factory.connect(
	senderAddress,
	lineaProvider
);

const callData = simpleAccount.interface.encodeFunctionData("execute", [
	to,
	value,
	data,
]);
console.log("Generated CallData: ", callData);

const userOperation = {
	sender: senderAddress,
	nonce: ethers.utils.hexlify(0),
	initCode,
	callData,
	callGasLimit: ethers.utils.hexlify(100_000), // hardcode it for now at a high value
	verificationGasLimit: ethers.utils.hexlify(400_000), // hardcode it for now at a high value
	preVerificationGas: ethers.utils.hexlify(50_000), // hardcode it for now at a high value
	maxFeePerGas: ethers.utils.hexlify(gasPrice),
	maxPriorityFeePerGas: ethers.utils.hexlify(gasPrice),
	paymasterAndData: "0x",
	signature: "0x",
};

const sponsorUserOperationResult = await pimlicoProvider.send(
	"pm_sponsorUserOperation",
	[
		userOperation,
		{
			entryPoint: ENTRY_POINT_ADDRESS,
		},
	]
);

const paymasterAndData = sponsorUserOperationResult.paymasterAndData;
userOperation.paymasterAndData = paymasterAndData;
console.log("Pimlico paymasterAndData:", paymasterAndData);

// SIGN THE USER OPERATION
const signature = await owner.signMessage(
	ethers.utils.arrayify(await entryPoint.getUserOpHash(userOperation))
);
userOperation.signature = signature;
console.log("UserOperation signature:", signature);

// SUBMIT THE USER OPERATION TO BE BUNDLED
const userOperationHash = await pimlicoProvider.send("eth_sendUserOperation", [
	userOperation,
	ENTRY_POINT_ADDRESS,
]);
console.log("UserOperation hash:", userOperationHash);

// let's also wait for the userOperation to be included, by continually querying for the receipts
console.log("Querying for receipts...");
let receipt = null;
while (receipt === null) {
	await new Promise((resolve) => setTimeout(resolve, 1000));
	receipt = await pimlicoProvider.send("eth_getUserOperationReceipt", [
		userOperationHash,
	]);
	console.log(receipt === null ? "Still waiting..." : receipt);
}

const txHash = receipt.receipt.transactionHash;
console.log(
	`UserOperation included: https://goerli.lineascan.build/tx/${txHash}`
);
