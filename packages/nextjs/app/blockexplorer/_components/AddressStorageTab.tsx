"use client";

import { useEffect, useState } from "react";
import { Address, createPublicClient, http, toHex } from "viem";
import { hardhat } from "viem/chains";

const publicClient = createPublicClient({
  chain: hardhat,
  transport: http(),
});

const MAX_STORAGE_SLOTS = 64;

export const AddressStorageTab = ({ address }: { address: Address }) => {
  const [storage, setStorage] = useState<string[]>([]);

  useEffect(() => {
    const fetchStorage = async () => {
      try {
        const storageData = [];
        // Storage is sparse: a zero slot is not an end marker and populated slots can follow it.
        // Scan a fixed window of low slots (where simple contracts keep their state) instead of looping
        // until the first zero, which could miss state or issue unbounded RPC calls.
        for (let idx = 0; idx < MAX_STORAGE_SLOTS; idx++) {
          const storageAtPosition = await publicClient.getStorageAt({
            address: address,
            slot: toHex(idx),
          });

          // Keep zero slots too, so the array index stays equal to the slot number shown below.
          storageData.push(storageAtPosition ?? "0x" + "0".repeat(64));
        }
        setStorage(storageData);
      } catch (error) {
        console.error("Failed to fetch storage:", error);
      }
    };

    fetchStorage();
  }, [address]);

  return (
    <div className="flex flex-col gap-3 p-4">
      {storage.length > 0 ? (
        <div className="mockup-code overflow-auto max-h-[500px]">
          <pre className="px-5 whitespace-pre-wrap break-words">
            {storage.map((data, i) => (
              <div key={i}>
                <strong>Storage Slot {i}:</strong> {data}
              </div>
            ))}
          </pre>
        </div>
      ) : (
        <div className="text-lg">This contract does not have any variables.</div>
      )}
    </div>
  );
};
