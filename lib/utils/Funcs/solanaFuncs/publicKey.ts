import { PublicKey } from "@solana/web3.js";

const publicKey = (address: string) => {
  console.log(address, typeof address);
  return new PublicKey(address);
};

export default publicKey;
