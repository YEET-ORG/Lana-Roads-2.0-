/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/crossy_world.json`.
 */
export type CrossyWorld = {
  "address": "5FBMHsiUcRZ5RiKYWd6XhRGkA3FifP4nji9RKijLYuLx",
  "metadata": {
    "name": "crossyWorld",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Crossy World — contract-first realtime grid competition on Solana + MagicBlock"
  },
  "instructions": [
    {
      "name": "acceptAdmin",
      "discriminator": [
        112,
        42,
        45,
        90,
        116,
        181,
        13,
        170
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "proposed",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "activateSeason",
      "discriminator": [
        65,
        12,
        62,
        60,
        29,
        166,
        239,
        206
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "seasonIndex"
              }
            ]
          }
        },
        {
          "name": "standardBanner"
        },
        {
          "name": "enhancedBanner"
        },
        {
          "name": "premiumBanner"
        },
        {
          "name": "commonPool"
        },
        {
          "name": "rarePool"
        },
        {
          "name": "epicPool"
        },
        {
          "name": "legendaryPool"
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "seasonIndex",
          "type": "u16"
        }
      ]
    },
    {
      "name": "assignPull",
      "discriminator": [
        230,
        94,
        74,
        130,
        138,
        130,
        112,
        65
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "season",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pull.season",
                "account": "gachaPull"
              }
            ]
          }
        },
        {
          "name": "banner",
          "writable": true
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pull.player",
                "account": "gachaPull"
              }
            ]
          }
        },
        {
          "name": "pull",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pull.player",
                "account": "gachaPull"
              },
              {
                "kind": "account",
                "path": "pull.pull_nonce",
                "account": "gachaPull"
              }
            ]
          }
        },
        {
          "name": "commonPool",
          "writable": true
        },
        {
          "name": "rarePool",
          "writable": true
        },
        {
          "name": "epicPool",
          "writable": true
        },
        {
          "name": "legendaryPool",
          "writable": true
        },
        {
          "name": "selectedVariant",
          "docs": [
            "The variant that will be reserved (selected deterministically; the",
            "handler re-derives the selection and requires this account to match)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  114,
                  105,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pull.season",
                "account": "gachaPull"
              },
              {
                "kind": "account",
                "path": "selected_variant.variant_id",
                "account": "variantInventory"
              }
            ]
          }
        },
        {
          "name": "teamTreasury",
          "docs": [
            "Team treasury: assignment finalizes the revenue."
          ],
          "writable": true
        },
        {
          "name": "gachaVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  99,
                  104,
                  97,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "gachaVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  99,
                  104,
                  97,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "beginPaidAttempt",
      "discriminator": [
        230,
        186,
        238,
        16,
        43,
        10,
        83,
        185
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "daily",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "run",
          "docs": [
            "PDA + discriminator in the handler."
          ]
        },
        {
          "name": "payerToken",
          "docs": [
            "Payer's USDC account."
          ],
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "receipt",
          "writable": true
        },
        {
          "name": "contribution",
          "writable": true
        },
        {
          "name": "wallet",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "beginRevive",
      "discriminator": [
        154,
        253,
        133,
        55,
        2,
        235,
        247,
        173
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "daily",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "run"
        },
        {
          "name": "payerToken",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "receipt",
          "writable": true
        },
        {
          "name": "wallet",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "buyListing",
      "discriminator": [
        115,
        149,
        42,
        108,
        44,
        49,
        140,
        153
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "asset",
          "writable": true
        },
        {
          "name": "collection",
          "writable": true
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "listing.asset",
                "account": "marketplaceListing"
              }
            ]
          }
        },
        {
          "name": "buyerToken",
          "docs": [
            "Buyer's USDC account."
          ],
          "writable": true
        },
        {
          "name": "sellerToken",
          "docs": [
            "Seller proceeds: canonical USDC account owned by the listing seller."
          ],
          "writable": true
        },
        {
          "name": "teamTreasury",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "freezeAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  114,
                  101,
                  101,
                  122,
                  101,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "coreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "cancelAdminProposal",
      "discriminator": [
        68,
        6,
        145,
        131,
        16,
        73,
        182,
        229
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "checkHazard",
      "discriminator": [
        11,
        215,
        48,
        101,
        213,
        4,
        245,
        203
      ],
      "accounts": [
        {
          "name": "world",
          "writable": true
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "run.wallet",
                "account": "playerRun"
              }
            ]
          }
        },
        {
          "name": "sector",
          "docs": [
            "Sector containing the run's current tile."
          ],
          "writable": true
        },
        {
          "name": "driftSector",
          "docs": [
            "Sector the player drifts into when a log carries them across a sector",
            "boundary; None when the drift stays inside `sector` or cannot happen."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "chunk",
          "docs": [
            "Chunk covering the run's current row."
          ]
        }
      ],
      "args": [
        {
          "name": "hazardNonce",
          "type": "u32"
        }
      ]
    },
    {
      "name": "claimPull",
      "discriminator": [
        154,
        192,
        212,
        60,
        190,
        129,
        213,
        239
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pull",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pull.player",
                "account": "gachaPull"
              },
              {
                "kind": "account",
                "path": "pull.pull_nonce",
                "account": "gachaPull"
              }
            ]
          }
        },
        {
          "name": "variant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  114,
                  105,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pull.season",
                "account": "gachaPull"
              },
              {
                "kind": "account",
                "path": "pull.assigned_variant",
                "account": "gachaPull"
              }
            ]
          }
        },
        {
          "name": "asset",
          "docs": [
            "New asset keypair (client-generated, signs creation)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "assetMap",
          "docs": [
            "Program-owned asset -> class binding, written now."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  115,
                  115,
                  101,
                  116,
                  95,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "collection",
          "writable": true
        },
        {
          "name": "mintAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "owner"
        },
        {
          "name": "payer",
          "docs": [
            "Permissionless sponsor pays rent/fees; owner is fixed above."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "coreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        }
      ],
      "args": [
        {
          "name": "uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "claimRecord",
      "discriminator": [
        133,
        27,
        123,
        25,
        142,
        156,
        32,
        147
      ],
      "accounts": [
        {
          "name": "world",
          "writable": true
        },
        {
          "name": "best",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "best.wallet",
                "account": "dailyBest"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "claimStarter",
      "discriminator": [
        142,
        187,
        84,
        81,
        84,
        148,
        223,
        217
      ],
      "accounts": [
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "wallet",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "claimVoidRefund",
      "discriminator": [
        216,
        90,
        25,
        165,
        100,
        32,
        61,
        189
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "daily",
          "writable": true
        },
        {
          "name": "vaultAuthority"
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "contribution",
          "writable": true
        },
        {
          "name": "walletToken",
          "docs": [
            "Fixed recipient: the contribution wallet's canonical USDC account."
          ],
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "closeDay",
      "discriminator": [
        156,
        214,
        132,
        15,
        27,
        77,
        42,
        79
      ],
      "accounts": [
        {
          "name": "daily",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "closeWorld",
      "discriminator": [
        250,
        171,
        64,
        179,
        30,
        236,
        152,
        24
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "world",
          "writable": true
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "closeWorldBase",
      "discriminator": [
        13,
        159,
        71,
        42,
        227,
        23,
        9,
        67
      ],
      "accounts": [
        {
          "name": "world",
          "writable": true
        },
        {
          "name": "closer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "commitState",
      "discriminator": [
        201,
        80,
        148,
        145,
        9,
        196,
        225,
        56
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "completeRevive",
      "discriminator": [
        231,
        169,
        211,
        226,
        167,
        160,
        86,
        11
      ],
      "accounts": [
        {
          "name": "world",
          "writable": true
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "run.wallet",
                "account": "playerRun"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "docs": [
            "Revival receipt: cloned base account, read-only payment evidence."
          ]
        },
        {
          "name": "safeSector",
          "docs": [
            "Sector containing the saved safe tile (revival placement)."
          ],
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "consumePullRandomness",
      "discriminator": [
        83,
        66,
        163,
        210,
        208,
        1,
        5,
        113
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "docs": [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program."
          ],
          "signer": true
        },
        {
          "name": "pull",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pull.player",
                "account": "gachaPull"
              },
              {
                "kind": "account",
                "path": "pull.pull_nonce",
                "account": "gachaPull"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "generation",
          "type": "u16"
        }
      ]
    },
    {
      "name": "consumeRollover",
      "discriminator": [
        55,
        239,
        56,
        94,
        188,
        23,
        78,
        52
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "previous",
          "writable": true
        },
        {
          "name": "daily",
          "writable": true
        },
        {
          "name": "previousVaultAuthority"
        },
        {
          "name": "previousVault",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "createBanner",
      "discriminator": [
        46,
        225,
        20,
        199,
        192,
        162,
        236,
        46
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "season",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "seasonIndex"
              }
            ]
          }
        },
        {
          "name": "banner",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "seasonIndex",
          "type": "u16"
        },
        {
          "name": "tier",
          "type": "u8"
        },
        {
          "name": "baseWeights",
          "type": {
            "array": [
              "u16",
              4
            ]
          }
        }
      ]
    },
    {
      "name": "createClassConfig",
      "discriminator": [
        149,
        85,
        166,
        215,
        52,
        169,
        123,
        1
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "classConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  108,
                  97,
                  115,
                  115
                ]
              },
              {
                "kind": "arg",
                "path": "classId"
              },
              {
                "kind": "arg",
                "path": "version"
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "classId",
          "type": "u16"
        },
        {
          "name": "version",
          "type": "u16"
        },
        {
          "name": "ability",
          "type": {
            "defined": {
              "name": "abilityKind"
            }
          }
        },
        {
          "name": "cooldownSeconds",
          "type": "u16"
        },
        {
          "name": "range",
          "type": "u8"
        },
        {
          "name": "durationSeconds",
          "type": "u16"
        },
        {
          "name": "displacement",
          "type": "u8"
        },
        {
          "name": "paramA",
          "type": "u16"
        },
        {
          "name": "paramB",
          "type": "u16"
        },
        {
          "name": "minRarity",
          "type": "u8"
        },
        {
          "name": "activationDay",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createSeason",
      "discriminator": [
        38,
        108,
        29,
        127,
        60,
        126,
        101,
        3
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "seasonIndex"
              }
            ]
          }
        },
        {
          "name": "commonPool",
          "writable": true
        },
        {
          "name": "rarePool",
          "writable": true
        },
        {
          "name": "epicPool",
          "writable": true
        },
        {
          "name": "legendaryPool",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "seasonIndex",
          "type": "u16"
        },
        {
          "name": "startDay",
          "type": "u64"
        },
        {
          "name": "weightsHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "classBalanceVersion",
          "type": "u16"
        },
        {
          "name": "metadataVersion",
          "type": "u16"
        }
      ]
    },
    {
      "name": "createVariant",
      "discriminator": [
        83,
        44,
        60,
        73,
        56,
        90,
        186,
        115
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "seasonIndex"
              }
            ]
          }
        },
        {
          "name": "classConfig",
          "docs": [
            "The class this variant maps to must exist (any version)."
          ]
        },
        {
          "name": "rarityPool",
          "writable": true
        },
        {
          "name": "variant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  114,
                  105,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "seasonIndex"
              },
              {
                "kind": "arg",
                "path": "variantId"
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "seasonIndex",
          "type": "u16"
        },
        {
          "name": "variantId",
          "type": "u16"
        },
        {
          "name": "rarity",
          "type": "u8"
        },
        {
          "name": "modelId",
          "type": "u16"
        },
        {
          "name": "cosmeticId",
          "type": "u16"
        },
        {
          "name": "metadataUriHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "supplyCap",
          "type": "u32"
        }
      ]
    },
    {
      "name": "delegateBest",
      "discriminator": [
        213,
        72,
        149,
        44,
        81,
        91,
        112,
        144
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "worldAccount",
          "docs": [
            "delegation lands on the same rollup the world does."
          ]
        },
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "bufferPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                63,
                16,
                148,
                230,
                60,
                29,
                57,
                216,
                248,
                87,
                161,
                210,
                114,
                232,
                17,
                80,
                15,
                65,
                234,
                116,
                35,
                31,
                44,
                144,
                115,
                76,
                107,
                220,
                38,
                71,
                168,
                93
              ]
            }
          }
        },
        {
          "name": "delegationRecordPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "pda",
          "writable": true
        },
        {
          "name": "ownerProgram",
          "address": "5FBMHsiUcRZ5RiKYWd6XhRGkA3FifP4nji9RKijLYuLx"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "world",
          "type": "pubkey"
        },
        {
          "name": "wallet",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "delegateChunk",
      "discriminator": [
        241,
        100,
        192,
        34,
        123,
        91,
        65,
        217
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "bufferPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                63,
                16,
                148,
                230,
                60,
                29,
                57,
                216,
                248,
                87,
                161,
                210,
                114,
                232,
                17,
                80,
                15,
                65,
                234,
                116,
                35,
                31,
                44,
                144,
                115,
                76,
                107,
                220,
                38,
                71,
                168,
                93
              ]
            }
          }
        },
        {
          "name": "delegationRecordPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "pda",
          "writable": true
        },
        {
          "name": "ownerProgram",
          "address": "5FBMHsiUcRZ5RiKYWd6XhRGkA3FifP4nji9RKijLYuLx"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "region",
          "type": "u8"
        },
        {
          "name": "day",
          "type": "u64"
        },
        {
          "name": "chunkIndex",
          "type": "u32"
        }
      ]
    },
    {
      "name": "delegateRun",
      "discriminator": [
        20,
        67,
        38,
        40,
        32,
        211,
        235,
        131
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "worldAccount",
          "docs": [
            "delegation lands on the same rollup the world does."
          ]
        },
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "bufferPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                63,
                16,
                148,
                230,
                60,
                29,
                57,
                216,
                248,
                87,
                161,
                210,
                114,
                232,
                17,
                80,
                15,
                65,
                234,
                116,
                35,
                31,
                44,
                144,
                115,
                76,
                107,
                220,
                38,
                71,
                168,
                93
              ]
            }
          }
        },
        {
          "name": "delegationRecordPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "pda",
          "writable": true
        },
        {
          "name": "ownerProgram",
          "address": "5FBMHsiUcRZ5RiKYWd6XhRGkA3FifP4nji9RKijLYuLx"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "world",
          "type": "pubkey"
        },
        {
          "name": "wallet",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "delegateSector",
      "discriminator": [
        67,
        215,
        204,
        22,
        86,
        161,
        237,
        210
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "worldAccount",
          "docs": [
            "cross-plane and validated against its own self-describing PDA."
          ]
        },
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "bufferPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                63,
                16,
                148,
                230,
                60,
                29,
                57,
                216,
                248,
                87,
                161,
                210,
                114,
                232,
                17,
                80,
                15,
                65,
                234,
                116,
                35,
                31,
                44,
                144,
                115,
                76,
                107,
                220,
                38,
                71,
                168,
                93
              ]
            }
          }
        },
        {
          "name": "delegationRecordPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "pda",
          "writable": true
        },
        {
          "name": "ownerProgram",
          "address": "5FBMHsiUcRZ5RiKYWd6XhRGkA3FifP4nji9RKijLYuLx"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "world",
          "type": "pubkey"
        },
        {
          "name": "sectorX",
          "type": "u8"
        },
        {
          "name": "sectorY",
          "type": "u32"
        }
      ]
    },
    {
      "name": "delegateWorld",
      "discriminator": [
        67,
        161,
        240,
        171,
        81,
        236,
        193,
        79
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "bufferPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                63,
                16,
                148,
                230,
                60,
                29,
                57,
                216,
                248,
                87,
                161,
                210,
                114,
                232,
                17,
                80,
                15,
                65,
                234,
                116,
                35,
                31,
                44,
                144,
                115,
                76,
                107,
                220,
                38,
                71,
                168,
                93
              ]
            }
          }
        },
        {
          "name": "delegationRecordPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "pda",
          "writable": true
        },
        {
          "name": "ownerProgram",
          "address": "5FBMHsiUcRZ5RiKYWd6XhRGkA3FifP4nji9RKijLYuLx"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "region",
          "type": "u8"
        },
        {
          "name": "mode",
          "type": "u8"
        },
        {
          "name": "day",
          "type": "u64"
        }
      ]
    },
    {
      "name": "delistAgent",
      "discriminator": [
        243,
        7,
        164,
        26,
        25,
        34,
        96,
        95
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "asset",
          "writable": true
        },
        {
          "name": "collection",
          "writable": true
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "listing.asset",
                "account": "marketplaceListing"
              }
            ]
          }
        },
        {
          "name": "freezeAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  114,
                  101,
                  101,
                  122,
                  101,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "seller",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "coreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        }
      ],
      "args": []
    },
    {
      "name": "endAttempt",
      "discriminator": [
        72,
        172,
        188,
        183,
        9,
        104,
        221,
        75
      ],
      "accounts": [
        {
          "name": "world",
          "writable": true
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "run.wallet",
                "account": "playerRun"
              }
            ]
          }
        },
        {
          "name": "sector",
          "docs": [
            "Sector containing the run's current tile (occupancy release)."
          ],
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "endSession",
      "discriminator": [
        11,
        244,
        61,
        154,
        212,
        249,
        15,
        66
      ],
      "accounts": [
        {
          "name": "run",
          "writable": true
        },
        {
          "name": "wallet",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "ensureProfile",
      "discriminator": [
        63,
        176,
        19,
        63,
        32,
        236,
        97,
        80
      ],
      "accounts": [
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "wallet",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "expireRevival",
      "discriminator": [
        70,
        49,
        68,
        73,
        96,
        250,
        213,
        158
      ],
      "accounts": [
        {
          "name": "world"
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "run.wallet",
                "account": "playerRun"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "extendFrontier",
      "discriminator": [
        91,
        37,
        169,
        36,
        252,
        191,
        74,
        5
      ],
      "accounts": [
        {
          "name": "world",
          "writable": true
        },
        {
          "name": "chunk",
          "docs": [
            "The next chunk, already revealed on base and read cross-plane here."
          ]
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "finalizeDay",
      "discriminator": [
        88,
        77,
        250,
        153,
        57,
        146,
        161,
        198
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "daily",
          "writable": true
        },
        {
          "name": "vaultAuthority"
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "winnerToken",
          "docs": [
            "Winner USDC token account: must belong to the recorded winner and the",
            "canonical mint. The admin supplies the account but cannot substitute",
            "the owner. On a no-winner day (settled_score == 0) no winner transfer",
            "occurs, so any canonical-mint token account satisfies the slot."
          ],
          "writable": true
        },
        {
          "name": "teamTreasury",
          "docs": [
            "Team treasury fixed by config."
          ],
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "initRun",
      "discriminator": [
        148,
        105,
        121,
        172,
        230,
        223,
        101,
        42
      ],
      "accounts": [
        {
          "name": "world",
          "docs": [
            "(owner = delegation program), so a typed Account would reject it —",
            "the handler validates address + discriminator via",
            "`read_committed_world` and reads the immutable day window from the",
            "committed data."
          ]
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "best",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "wallet",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "sessionAuthority",
          "type": "pubkey"
        },
        {
          "name": "sessionExpiry",
          "type": "i64"
        }
      ]
    },
    {
      "name": "initSector",
      "discriminator": [
        247,
        174,
        248,
        186,
        38,
        154,
        23,
        252
      ],
      "accounts": [
        {
          "name": "world",
          "docs": [
            "typed account would reject it and no sector could ever be created for",
            "newly revealed rows. The handler validates it by committed read +",
            "mode/day PDA derivation, exactly like `init_run`."
          ]
        },
        {
          "name": "chunk",
          "docs": [
            "Chunk covering this sector's rows (blocker derivation). Its address is",
            "pinned in the handler against the committed world's day, since the",
            "day is not available to the seeds expression here."
          ]
        },
        {
          "name": "sector",
          "writable": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "sectorX",
          "type": "u8"
        },
        {
          "name": "sectorY",
          "type": "u32"
        }
      ]
    },
    {
      "name": "initializeConfig",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "docs": [
            "Canonical USDC mint; decimals verified."
          ]
        },
        {
          "name": "teamTreasury",
          "docs": [
            "Team treasury token account for the canonical mint."
          ]
        },
        {
          "name": "collection",
          "docs": [
            "collection creation; stored for later strict comparisons."
          ]
        },
        {
          "name": "collectionAuthority"
        },
        {
          "name": "validator",
          "docs": [
            "Further regions are added with `set_validator`, so a deployment starts",
            "playable in one place rather than requiring every rollup up front."
          ]
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "maxPaidPlayers",
          "type": "u16"
        },
        {
          "name": "maxCasualPlayers",
          "type": "u16"
        }
      ]
    },
    {
      "name": "kick",
      "discriminator": [
        184,
        92,
        149,
        185,
        62,
        150,
        19,
        210
      ],
      "accounts": [
        {
          "name": "world"
        },
        {
          "name": "kicker",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "kicker.wallet",
                "account": "playerRun"
              }
            ]
          }
        },
        {
          "name": "target",
          "docs": [
            "The player being kicked. Optional: a kick thrown at empty space is a",
            "legal, wasted kick rather than a failed transaction."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "target.wallet",
                "account": "playerRun"
              }
            ]
          }
        },
        {
          "name": "targetSector",
          "docs": [
            "Sector containing the target's current tile."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "destSector",
          "docs": [
            "Sector containing the knockback destination; None when it shares the",
            "target's sector (Anchor forbids duplicate mutable accounts)."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "chunk",
          "docs": [
            "Chunk covering the knockback destination row."
          ],
          "optional": true
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "attemptNonce",
          "type": "u32"
        },
        {
          "name": "actionSeq",
          "type": "u64"
        },
        {
          "name": "uniq",
          "type": "u64"
        }
      ]
    },
    {
      "name": "listAgent",
      "discriminator": [
        158,
        60,
        228,
        0,
        50,
        242,
        199,
        221
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "asset",
          "writable": true
        },
        {
          "name": "collection",
          "writable": true
        },
        {
          "name": "assetMap",
          "docs": [
            "Program-owned asset mapping (collection membership proof)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  115,
                  115,
                  101,
                  116,
                  95,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "freezeAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  114,
                  101,
                  101,
                  122,
                  101,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "seller",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "coreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        }
      ],
      "args": [
        {
          "name": "price",
          "type": "u64"
        },
        {
          "name": "expiryTs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "lockAgent",
      "discriminator": [
        100,
        216,
        180,
        95,
        45,
        189,
        23,
        116
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "world",
          "docs": [
            "Target world for this attempt (address recorded in the lock).",
            "handler (may be delegated)."
          ]
        },
        {
          "name": "asset",
          "docs": [
            "The Core asset being locked. `Pubkey::default()`-marker starters use",
            "`lock_starter` instead."
          ],
          "writable": true
        },
        {
          "name": "collection",
          "writable": true
        },
        {
          "name": "assetMap",
          "docs": [
            "Program-owned asset -> variant/class binding written at mint."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  115,
                  115,
                  101,
                  116,
                  95,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "listing",
          "docs": [
            "No active listing may exist for the asset (lock/listing mutual",
            "exclusion): the listing PDA must not be an initialized active listing."
          ]
        },
        {
          "name": "lock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116,
                  95,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "wallet"
              },
              {
                "kind": "arg",
                "path": "attemptNonce"
              }
            ]
          }
        },
        {
          "name": "freezeAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  114,
                  101,
                  101,
                  122,
                  101,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "wallet",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "coreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        }
      ],
      "args": [
        {
          "name": "attemptNonce",
          "type": "u32"
        }
      ]
    },
    {
      "name": "lockStarter",
      "discriminator": [
        245,
        219,
        36,
        103,
        68,
        130,
        179,
        126
      ],
      "accounts": [
        {
          "name": "profile",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "world"
        },
        {
          "name": "lock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116,
                  95,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "wallet"
              },
              {
                "kind": "arg",
                "path": "attemptNonce"
              }
            ]
          }
        },
        {
          "name": "wallet",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "attemptNonce",
          "type": "u32"
        }
      ]
    },
    {
      "name": "markChunkReady",
      "discriminator": [
        54,
        96,
        115,
        15,
        128,
        90,
        245,
        61
      ],
      "accounts": [
        {
          "name": "world",
          "writable": true
        },
        {
          "name": "chunk"
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "chunkIndex",
          "type": "u32"
        }
      ]
    },
    {
      "name": "moveAction",
      "discriminator": [
        108,
        96,
        65,
        5,
        227,
        202,
        16,
        219
      ],
      "accounts": [
        {
          "name": "world",
          "docs": [
            "Mutable: a move into a hazard window is fatal, and death updates the",
            "world's active-player count."
          ],
          "writable": true
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "run.wallet",
                "account": "playerRun"
              }
            ]
          }
        },
        {
          "name": "sourceSector",
          "docs": [
            "Source sector (must match the run's current tile)."
          ],
          "writable": true
        },
        {
          "name": "destSector",
          "docs": [
            "Destination sector for cross-sector moves; None when the destination",
            "shares the source sector (Anchor forbids duplicate mutable accounts)."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "chunk",
          "docs": [
            "Chunk covering the destination row."
          ]
        },
        {
          "name": "best",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "run.wallet",
                "account": "playerRun"
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "attemptNonce",
          "type": "u32"
        },
        {
          "name": "actionSeq",
          "type": "u64"
        },
        {
          "name": "direction",
          "type": "u8"
        },
        {
          "name": "uniq",
          "type": "u64"
        }
      ]
    },
    {
      "name": "moveBatch",
      "discriminator": [
        92,
        42,
        50,
        169,
        171,
        194,
        139,
        36
      ],
      "accounts": [
        {
          "name": "world",
          "writable": true
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "run.wallet",
                "account": "playerRun"
              }
            ]
          }
        },
        {
          "name": "sectorA",
          "docs": [
            "Sectors the batch may touch. `sector_a` must cover the starting tile;",
            "the rest are whatever the client's intended path also crosses. Anchor",
            "forbids passing the same account twice, so these are all distinct."
          ],
          "writable": true
        },
        {
          "name": "sectorB",
          "writable": true,
          "optional": true
        },
        {
          "name": "sectorC",
          "writable": true,
          "optional": true
        },
        {
          "name": "sectorD",
          "writable": true,
          "optional": true
        },
        {
          "name": "chunkA",
          "docs": [
            "Chunks covering the rows the batch may enter."
          ]
        },
        {
          "name": "chunkB",
          "optional": true
        },
        {
          "name": "best",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "run.wallet",
                "account": "playerRun"
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "attemptNonce",
          "type": "u32"
        },
        {
          "name": "actionSeq",
          "type": "u64"
        },
        {
          "name": "directions",
          "type": "bytes"
        },
        {
          "name": "uniq",
          "type": "u64"
        }
      ]
    },
    {
      "name": "moveFree",
      "discriminator": [
        230,
        196,
        240,
        179,
        117,
        155,
        152,
        169
      ],
      "accounts": [
        {
          "name": "world",
          "docs": [
            "Mutable: a move into a hazard window is fatal, and death updates the",
            "world's active-player count."
          ],
          "writable": true
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "run.wallet",
                "account": "playerRun"
              }
            ]
          }
        },
        {
          "name": "sourceSector",
          "docs": [
            "Source sector (must match the run's current tile)."
          ],
          "writable": true
        },
        {
          "name": "destSector",
          "docs": [
            "Destination sector for cross-sector moves; None when the destination",
            "shares the source sector (Anchor forbids duplicate mutable accounts)."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "chunk",
          "docs": [
            "Chunk covering the destination row."
          ]
        },
        {
          "name": "best",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "run.wallet",
                "account": "playerRun"
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "attemptNonce",
          "type": "u32"
        },
        {
          "name": "direction",
          "type": "u8"
        },
        {
          "name": "uniq",
          "type": "u64"
        }
      ]
    },
    {
      "name": "openDay",
      "discriminator": [
        119,
        83,
        233,
        162,
        20,
        187,
        32,
        140
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "daily",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "prepareDay",
      "discriminator": [
        100,
        72,
        208,
        172,
        35,
        161,
        96,
        24
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "daily",
          "writable": true
        },
        {
          "name": "vaultAuthority"
        },
        {
          "name": "vault",
          "docs": [
            "Day vault token account owned by the vault authority PDA."
          ],
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "paidWorld",
          "writable": true
        },
        {
          "name": "casualWorld",
          "writable": true
        },
        {
          "name": "spawnChunk",
          "docs": [
            "The safe/spawn chunk (index 0) is deterministic — created revealed."
          ],
          "writable": true
        },
        {
          "name": "commitPayer"
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "region",
          "type": "u8"
        },
        {
          "name": "day",
          "type": "u64"
        }
      ]
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  101,
                  45,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "baseAccount"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                181,
                183,
                0,
                225,
                242,
                87,
                58,
                192,
                204,
                6,
                34,
                1,
                52,
                74,
                207,
                151,
                184,
                53,
                6,
                235,
                140,
                229,
                25,
                152,
                204,
                98,
                126,
                24,
                147,
                128,
                167,
                62
              ]
            }
          }
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "proposeAdmin",
      "discriminator": [
        121,
        214,
        199,
        212,
        87,
        39,
        117,
        234
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "publishChunk",
      "discriminator": [
        61,
        194,
        106,
        57,
        153,
        64,
        135,
        50
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "docs": [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program."
          ],
          "signer": true
        },
        {
          "name": "chunk",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "region",
          "type": "u8"
        },
        {
          "name": "day",
          "type": "u64"
        },
        {
          "name": "chunkIndex",
          "type": "u32"
        },
        {
          "name": "generation",
          "type": "u16"
        }
      ]
    },
    {
      "name": "reconcileReceipt",
      "discriminator": [
        158,
        153,
        97,
        18,
        105,
        92,
        72,
        247
      ],
      "accounts": [
        {
          "name": "daily",
          "writable": true
        },
        {
          "name": "receipt",
          "writable": true
        },
        {
          "name": "run"
        },
        {
          "name": "contribution",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "recordFinalCommit",
      "discriminator": [
        185,
        226,
        246,
        211,
        71,
        44,
        190,
        51
      ],
      "accounts": [
        {
          "name": "daily",
          "writable": true
        },
        {
          "name": "paidWorld",
          "docs": [
            "The paid world account, now undelegated and committed back to base.",
            "Ownership by this program proves undelegation completed; its record",
            "fields are the final authority."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "refundPull",
      "discriminator": [
        207,
        171,
        0,
        146,
        188,
        39,
        84,
        166
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pull",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pull.player",
                "account": "gachaPull"
              },
              {
                "kind": "account",
                "path": "pull.pull_nonce",
                "account": "gachaPull"
              }
            ]
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pull.player",
                "account": "gachaPull"
              }
            ]
          }
        },
        {
          "name": "gachaVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  99,
                  104,
                  97,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "gachaVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  99,
                  104,
                  97,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "walletToken",
          "docs": [
            "Fixed recipient: the pull player's canonical USDC account."
          ],
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "refundReceipt",
      "discriminator": [
        185,
        54,
        110,
        2,
        162,
        27,
        187,
        111
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "daily",
          "writable": true
        },
        {
          "name": "vaultAuthority"
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "receipt",
          "writable": true
        },
        {
          "name": "walletToken",
          "docs": [
            "Destination: the receipt wallet's canonical USDC account. Fixed",
            "recipient; the caller may be anyone (permissionless sponsorship)."
          ],
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "requestChunk",
      "discriminator": [
        46,
        120,
        191,
        220,
        176,
        127,
        212,
        132
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "world"
        },
        {
          "name": "prevChunk"
        },
        {
          "name": "chunk",
          "writable": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "oracleQueue",
          "writable": true
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "region",
          "type": "u8"
        },
        {
          "name": "day",
          "type": "u64"
        },
        {
          "name": "chunkIndex",
          "type": "u32"
        }
      ]
    },
    {
      "name": "requestPull",
      "discriminator": [
        158,
        207,
        177,
        200,
        60,
        136,
        133,
        155
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "season",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "season.season_index",
                "account": "season"
              }
            ]
          }
        },
        {
          "name": "banner",
          "writable": true
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "commonPool"
        },
        {
          "name": "rarePool"
        },
        {
          "name": "epicPool"
        },
        {
          "name": "legendaryPool"
        },
        {
          "name": "pull",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              },
              {
                "kind": "account",
                "path": "profile.pull_count",
                "account": "playerProfile"
              }
            ]
          }
        },
        {
          "name": "gachaVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  99,
                  104,
                  97,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "gachaVault",
          "docs": [
            "Gacha vault token account (held pending until assignment/refund)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  99,
                  104,
                  97,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payerToken",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "wallet",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "oracleQueue",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "rotateSession",
      "discriminator": [
        105,
        76,
        255,
        50,
        28,
        5,
        13,
        132
      ],
      "accounts": [
        {
          "name": "run",
          "writable": true
        },
        {
          "name": "wallet",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "newAuthority",
          "type": "pubkey"
        },
        {
          "name": "newExpiry",
          "type": "i64"
        }
      ]
    },
    {
      "name": "setIdentity",
      "discriminator": [
        31,
        31,
        141,
        65,
        178,
        99,
        106,
        176
      ],
      "accounts": [
        {
          "name": "identity",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "wallet",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "agent",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setPause",
      "discriminator": [
        63,
        32,
        154,
        2,
        56,
        103,
        79,
        45
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "scope",
          "type": "u16"
        },
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setValidator",
      "discriminator": [
        150,
        135,
        78,
        171,
        156,
        91,
        161,
        221
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "region",
          "type": "u8"
        },
        {
          "name": "newValidator",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "spawn",
      "discriminator": [
        17,
        105,
        240,
        101,
        4,
        95,
        45,
        171
      ],
      "accounts": [
        {
          "name": "world",
          "writable": true
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "run.wallet",
                "account": "playerRun"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "docs": [
            "Entry receipt (paid mode): cloned base account, read-only evidence of",
            "finalized payment. Casual mode passes the world account here instead."
          ]
        },
        {
          "name": "agentLock",
          "docs": [
            "Agent lock for this attempt: program-derived class binding."
          ]
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "attemptNonce",
          "type": "u32"
        }
      ]
    },
    {
      "name": "undelegateState",
      "discriminator": [
        255,
        189,
        95,
        106,
        242,
        8,
        94,
        171
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "unlockAgent",
      "discriminator": [
        177,
        9,
        111,
        255,
        34,
        57,
        24,
        155
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "lock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116,
                  95,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "lock.world",
                "account": "agentLock"
              },
              {
                "kind": "account",
                "path": "lock.owner",
                "account": "agentLock"
              },
              {
                "kind": "account",
                "path": "lock.attempt_nonce",
                "account": "agentLock"
              }
            ]
          }
        },
        {
          "name": "run",
          "docs": [
            "terminal; or the day cutoff proves it (validated in handler)."
          ]
        },
        {
          "name": "world",
          "docs": [
            "day-cutoff evidence. Address fixed by the lock; validated in handler."
          ]
        },
        {
          "name": "asset",
          "writable": true
        },
        {
          "name": "collection",
          "writable": true
        },
        {
          "name": "freezeAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  114,
                  101,
                  101,
                  122,
                  101,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "coreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        }
      ],
      "args": []
    },
    {
      "name": "useAbility",
      "discriminator": [
        22,
        242,
        198,
        70,
        229,
        117,
        91,
        236
      ],
      "accounts": [
        {
          "name": "world"
        },
        {
          "name": "caster",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "world"
              },
              {
                "kind": "account",
                "path": "caster.wallet",
                "account": "playerRun"
              }
            ]
          }
        },
        {
          "name": "classConfig",
          "docs": [
            "Class config for the caster's class at the run's balance version."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  108,
                  97,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "caster.class_id",
                "account": "playerRun"
              },
              {
                "kind": "account",
                "path": "caster.class_version",
                "account": "playerRun"
              }
            ]
          }
        },
        {
          "name": "target",
          "docs": [
            "Target run for Ram/Hook/Swap; None for untargeted kinds."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "casterSector",
          "docs": [
            "Sector covering the caster's current tile."
          ],
          "writable": true
        },
        {
          "name": "destSector",
          "docs": [
            "Second sector for cross-sector destinations/effects; None when all",
            "touched tiles share the caster's sector."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "chunk",
          "docs": [
            "Chunk covering the destination/effect row."
          ]
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "attemptNonce",
          "type": "u32"
        },
        {
          "name": "actionSeq",
          "type": "u64"
        },
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "abilityArgs"
            }
          }
        },
        {
          "name": "uniq",
          "type": "u64"
        }
      ]
    },
    {
      "name": "voidDay",
      "discriminator": [
        142,
        138,
        100,
        116,
        2,
        59,
        49,
        24
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "daily",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "agentLock",
      "discriminator": [
        165,
        163,
        4,
        37,
        90,
        247,
        65,
        91
      ]
    },
    {
      "name": "assetMap",
      "discriminator": [
        145,
        44,
        98,
        78,
        206,
        80,
        78,
        68
      ]
    },
    {
      "name": "banner",
      "discriminator": [
        193,
        208,
        248,
        19,
        135,
        231,
        148,
        237
      ]
    },
    {
      "name": "chunkDefinition",
      "discriminator": [
        188,
        250,
        0,
        30,
        74,
        88,
        139,
        76
      ]
    },
    {
      "name": "classConfig",
      "discriminator": [
        12,
        14,
        218,
        247,
        8,
        85,
        10,
        250
      ]
    },
    {
      "name": "dailyBest",
      "discriminator": [
        122,
        210,
        192,
        25,
        243,
        52,
        114,
        31
      ]
    },
    {
      "name": "dailyCompetition",
      "discriminator": [
        214,
        178,
        240,
        129,
        203,
        24,
        67,
        127
      ]
    },
    {
      "name": "dailyContribution",
      "discriminator": [
        230,
        8,
        241,
        45,
        66,
        192,
        212,
        13
      ]
    },
    {
      "name": "gachaPull",
      "discriminator": [
        28,
        129,
        87,
        80,
        180,
        22,
        62,
        237
      ]
    },
    {
      "name": "globalConfig",
      "discriminator": [
        149,
        8,
        156,
        202,
        160,
        252,
        176,
        217
      ]
    },
    {
      "name": "marketplaceListing",
      "discriminator": [
        211,
        106,
        229,
        109,
        73,
        75,
        97,
        122
      ]
    },
    {
      "name": "occupancySector",
      "discriminator": [
        130,
        154,
        255,
        216,
        208,
        38,
        30,
        46
      ]
    },
    {
      "name": "paymentReceipt",
      "discriminator": [
        168,
        198,
        209,
        4,
        60,
        235,
        126,
        109
      ]
    },
    {
      "name": "playerIdentity",
      "discriminator": [
        85,
        172,
        40,
        166,
        220,
        193,
        194,
        235
      ]
    },
    {
      "name": "playerProfile",
      "discriminator": [
        82,
        226,
        99,
        87,
        164,
        130,
        181,
        80
      ]
    },
    {
      "name": "playerRun",
      "discriminator": [
        28,
        35,
        94,
        183,
        14,
        71,
        195,
        121
      ]
    },
    {
      "name": "rarityPool",
      "discriminator": [
        58,
        216,
        129,
        198,
        222,
        247,
        236,
        254
      ]
    },
    {
      "name": "season",
      "discriminator": [
        76,
        67,
        93,
        156,
        180,
        157,
        248,
        47
      ]
    },
    {
      "name": "variantInventory",
      "discriminator": [
        184,
        127,
        228,
        128,
        193,
        168,
        54,
        215
      ]
    },
    {
      "name": "worldHeader",
      "discriminator": [
        19,
        68,
        244,
        192,
        239,
        195,
        251,
        73
      ]
    }
  ],
  "events": [
    {
      "name": "adminRotated",
      "discriminator": [
        21,
        142,
        227,
        252,
        22,
        194,
        172,
        220
      ]
    },
    {
      "name": "adminRotationProposed",
      "discriminator": [
        52,
        35,
        148,
        44,
        226,
        153,
        9,
        148
      ]
    },
    {
      "name": "agentDelisted",
      "discriminator": [
        116,
        49,
        238,
        81,
        13,
        146,
        230,
        245
      ]
    },
    {
      "name": "agentListedEvent",
      "discriminator": [
        245,
        0,
        248,
        96,
        167,
        129,
        154,
        231
      ]
    },
    {
      "name": "agentLockedEvent",
      "discriminator": [
        94,
        49,
        209,
        231,
        68,
        103,
        51,
        29
      ]
    },
    {
      "name": "agentSold",
      "discriminator": [
        155,
        223,
        237,
        196,
        179,
        251,
        245,
        53
      ]
    },
    {
      "name": "agentUnlocked",
      "discriminator": [
        133,
        118,
        164,
        12,
        185,
        109,
        45,
        0
      ]
    },
    {
      "name": "attemptActivated",
      "discriminator": [
        49,
        200,
        231,
        153,
        7,
        205,
        233,
        165
      ]
    },
    {
      "name": "attemptEnded",
      "discriminator": [
        6,
        72,
        57,
        37,
        198,
        78,
        172,
        151
      ]
    },
    {
      "name": "bannerConfigured",
      "discriminator": [
        80,
        160,
        221,
        203,
        237,
        131,
        219,
        158
      ]
    },
    {
      "name": "chunkReady",
      "discriminator": [
        151,
        190,
        133,
        179,
        104,
        128,
        179,
        32
      ]
    },
    {
      "name": "chunkRequested",
      "discriminator": [
        182,
        230,
        16,
        41,
        23,
        208,
        201,
        132
      ]
    },
    {
      "name": "chunkRevealed",
      "discriminator": [
        89,
        16,
        190,
        148,
        192,
        148,
        185,
        85
      ]
    },
    {
      "name": "classConfigured",
      "discriminator": [
        246,
        220,
        81,
        89,
        151,
        192,
        8,
        124
      ]
    },
    {
      "name": "configInitialized",
      "discriminator": [
        181,
        49,
        200,
        156,
        19,
        167,
        178,
        91
      ]
    },
    {
      "name": "dayClosed",
      "discriminator": [
        152,
        8,
        69,
        146,
        232,
        175,
        151,
        96
      ]
    },
    {
      "name": "dayCommitted",
      "discriminator": [
        251,
        147,
        17,
        98,
        59,
        150,
        208,
        94
      ]
    },
    {
      "name": "dayOpened",
      "discriminator": [
        61,
        42,
        29,
        30,
        72,
        243,
        186,
        236
      ]
    },
    {
      "name": "dayPrepared",
      "discriminator": [
        84,
        207,
        52,
        234,
        176,
        157,
        87,
        9
      ]
    },
    {
      "name": "daySettled",
      "discriminator": [
        179,
        176,
        146,
        234,
        38,
        217,
        214,
        21
      ]
    },
    {
      "name": "dayVoided",
      "discriminator": [
        215,
        31,
        177,
        20,
        185,
        252,
        136,
        107
      ]
    },
    {
      "name": "frontierExtended",
      "discriminator": [
        182,
        49,
        74,
        133,
        2,
        83,
        34,
        158
      ]
    },
    {
      "name": "identitySet",
      "discriminator": [
        207,
        143,
        155,
        168,
        233,
        175,
        52,
        179
      ]
    },
    {
      "name": "pauseChanged",
      "discriminator": [
        238,
        188,
        213,
        78,
        134,
        209,
        178,
        218
      ]
    },
    {
      "name": "paymentConsumed",
      "discriminator": [
        145,
        118,
        93,
        76,
        48,
        120,
        126,
        98
      ]
    },
    {
      "name": "paymentPending",
      "discriminator": [
        51,
        228,
        157,
        113,
        223,
        197,
        169,
        9
      ]
    },
    {
      "name": "paymentRefundable",
      "discriminator": [
        22,
        212,
        78,
        66,
        112,
        179,
        178,
        14
      ]
    },
    {
      "name": "paymentRefunded",
      "discriminator": [
        197,
        178,
        204,
        105,
        247,
        64,
        159,
        4
      ]
    },
    {
      "name": "payoutLegCompleted",
      "discriminator": [
        76,
        108,
        8,
        21,
        169,
        20,
        144,
        149
      ]
    },
    {
      "name": "playerDied",
      "discriminator": [
        127,
        145,
        10,
        55,
        154,
        3,
        98,
        235
      ]
    },
    {
      "name": "playerRevived",
      "discriminator": [
        61,
        38,
        240,
        177,
        69,
        46,
        179,
        169
      ]
    },
    {
      "name": "pullAssigned",
      "discriminator": [
        78,
        91,
        87,
        165,
        227,
        20,
        126,
        162
      ]
    },
    {
      "name": "pullClaimed",
      "discriminator": [
        191,
        238,
        38,
        208,
        4,
        140,
        28,
        231
      ]
    },
    {
      "name": "pullRefunded",
      "discriminator": [
        80,
        238,
        108,
        202,
        93,
        150,
        181,
        56
      ]
    },
    {
      "name": "pullRequested",
      "discriminator": [
        105,
        183,
        238,
        244,
        238,
        146,
        60,
        196
      ]
    },
    {
      "name": "recordChanged",
      "discriminator": [
        102,
        255,
        50,
        79,
        141,
        238,
        163,
        118
      ]
    },
    {
      "name": "rolloverConsumed",
      "discriminator": [
        167,
        188,
        174,
        37,
        231,
        246,
        169,
        121
      ]
    },
    {
      "name": "rolloverCreated",
      "discriminator": [
        14,
        205,
        247,
        3,
        225,
        132,
        255,
        98
      ]
    },
    {
      "name": "seasonActivated",
      "discriminator": [
        15,
        222,
        137,
        105,
        208,
        146,
        188,
        6
      ]
    },
    {
      "name": "seasonConfigured",
      "discriminator": [
        60,
        185,
        237,
        132,
        142,
        177,
        102,
        16
      ]
    },
    {
      "name": "starterClaimed",
      "discriminator": [
        174,
        175,
        184,
        163,
        49,
        91,
        205,
        115
      ]
    },
    {
      "name": "validatorChanged",
      "discriminator": [
        59,
        121,
        4,
        77,
        62,
        29,
        214,
        54
      ]
    },
    {
      "name": "variantConfigured",
      "discriminator": [
        27,
        76,
        107,
        14,
        141,
        135,
        12,
        229
      ]
    },
    {
      "name": "voidRefundClaimed",
      "discriminator": [
        106,
        26,
        147,
        171,
        199,
        17,
        40,
        29
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notAdmin",
      "msg": "signer is not the configured admin"
    },
    {
      "code": 6001,
      "name": "notProposedAdmin",
      "msg": "signer is not the proposed admin"
    },
    {
      "code": 6002,
      "name": "notWallet",
      "msg": "signer is not the owning wallet"
    },
    {
      "code": 6003,
      "name": "badSession",
      "msg": "signer is not the registered session authority"
    },
    {
      "code": 6004,
      "name": "sessionExpired",
      "msg": "session is expired"
    },
    {
      "code": 6005,
      "name": "sessionScope",
      "msg": "session scope does not permit this action"
    },
    {
      "code": 6006,
      "name": "badVrfAuthority",
      "msg": "callback identity is not the authenticated VRF authority"
    },
    {
      "code": 6007,
      "name": "dayNotStarted",
      "msg": "day has not started"
    },
    {
      "code": 6008,
      "name": "cutoffPassed",
      "msg": "hard UTC cutoff has passed"
    },
    {
      "code": 6009,
      "name": "revivalExpired",
      "msg": "revival deadline has expired"
    },
    {
      "code": 6010,
      "name": "timeoutNotReached",
      "msg": "objective timeout has not been reached"
    },
    {
      "code": 6011,
      "name": "activationNotReached",
      "msg": "activation day has not been reached"
    },
    {
      "code": 6012,
      "name": "wrongMint",
      "msg": "wrong USDC mint"
    },
    {
      "code": 6013,
      "name": "wrongTokenProgram",
      "msg": "wrong token program"
    },
    {
      "code": 6014,
      "name": "wrongTokenOwner",
      "msg": "wrong token account owner"
    },
    {
      "code": 6015,
      "name": "wrongCollection",
      "msg": "asset is not in the configured collection"
    },
    {
      "code": 6016,
      "name": "wrongAssetOwner",
      "msg": "asset owner mismatch"
    },
    {
      "code": 6017,
      "name": "badClassMapping",
      "msg": "class or variant mapping is invalid or inactive"
    },
    {
      "code": 6018,
      "name": "metadataMismatch",
      "msg": "asset metadata URI does not match the configured variant"
    },
    {
      "code": 6019,
      "name": "agentLocked",
      "msg": "agent is locked for an active attempt"
    },
    {
      "code": 6020,
      "name": "agentListed",
      "msg": "agent is listed on the marketplace"
    },
    {
      "code": 6021,
      "name": "starterAlreadyClaimed",
      "msg": "starter entitlement already claimed"
    },
    {
      "code": 6022,
      "name": "starterNotClaimed",
      "msg": "starter entitlement not claimed"
    },
    {
      "code": 6023,
      "name": "wrongAmount",
      "msg": "payment amount does not match program-derived amount"
    },
    {
      "code": 6024,
      "name": "badReceiptState",
      "msg": "receipt is not in the required state"
    },
    {
      "code": 6025,
      "name": "receiptMismatch",
      "msg": "receipt does not match this run/attempt/death nonce"
    },
    {
      "code": 6026,
      "name": "wrongVault",
      "msg": "wrong vault account"
    },
    {
      "code": 6027,
      "name": "wrongTreasury",
      "msg": "wrong treasury account"
    },
    {
      "code": 6028,
      "name": "overflow",
      "msg": "checked arithmetic overflow"
    },
    {
      "code": 6029,
      "name": "liabilityMismatch",
      "msg": "vault liability invariant violated"
    },
    {
      "code": 6030,
      "name": "badBasisPoints",
      "msg": "basis points must sum to 10000"
    },
    {
      "code": 6031,
      "name": "soldOut",
      "msg": "variant is sold out"
    },
    {
      "code": 6032,
      "name": "staleInventory",
      "msg": "inventory revision is stale"
    },
    {
      "code": 6033,
      "name": "pityInventoryUnavailable",
      "msg": "required pity inventory unavailable; banner paused"
    },
    {
      "code": 6034,
      "name": "supplyExceeded",
      "msg": "supply cap exceeded"
    },
    {
      "code": 6035,
      "name": "invalidTransition",
      "msg": "invalid state transition"
    },
    {
      "code": 6036,
      "name": "alreadyTerminal",
      "msg": "already consumed, refunded, claimed, or settled"
    },
    {
      "code": 6037,
      "name": "dayNotOpen",
      "msg": "day is not prepared/open for this operation"
    },
    {
      "code": 6038,
      "name": "regionClosed",
      "msg": "no validator is configured for this rollup region"
    },
    {
      "code": 6039,
      "name": "dayVoided",
      "msg": "day is voided"
    },
    {
      "code": 6040,
      "name": "paused",
      "msg": "subsystem is paused"
    },
    {
      "code": 6041,
      "name": "badActionSequence",
      "msg": "duplicate or out-of-order action sequence"
    },
    {
      "code": 6042,
      "name": "badAttemptNonce",
      "msg": "attempt nonce mismatch"
    },
    {
      "code": 6043,
      "name": "badRunState",
      "msg": "run is not in the required state"
    },
    {
      "code": 6044,
      "name": "worldNotOpen",
      "msg": "world is not open"
    },
    {
      "code": 6045,
      "name": "attemptStillActive",
      "msg": "another attempt is still active for this wallet"
    },
    {
      "code": 6046,
      "name": "tileOccupied",
      "msg": "destination tile is occupied"
    },
    {
      "code": 6047,
      "name": "outOfBounds",
      "msg": "destination is out of bounds"
    },
    {
      "code": 6048,
      "name": "blocked",
      "msg": "destination terrain is not traversable"
    },
    {
      "code": 6049,
      "name": "worldFull",
      "msg": "world is full"
    },
    {
      "code": 6050,
      "name": "cooldown",
      "msg": "cooldown has not elapsed"
    },
    {
      "code": 6051,
      "name": "noTarget",
      "msg": "no valid target"
    },
    {
      "code": 6052,
      "name": "immobilized",
      "msg": "player is stunned or immobilized"
    },
    {
      "code": 6053,
      "name": "tooFast",
      "msg": "movement cadence exceeded for this slot"
    },
    {
      "code": 6054,
      "name": "invalidName",
      "msg": "Display name is empty, too long, or contains characters that cannot be shown"
    },
    {
      "code": 6055,
      "name": "staleHazardNonce",
      "msg": "hazard nonce is stale"
    },
    {
      "code": 6056,
      "name": "lethalTile",
      "msg": "tile is lethal at the authoritative time"
    },
    {
      "code": 6057,
      "name": "effectSlotsFull",
      "msg": "effect slots are full"
    },
    {
      "code": 6058,
      "name": "badAbility",
      "msg": "ability not available for this class/version"
    },
    {
      "code": 6059,
      "name": "frontierClosed",
      "msg": "chunk frontier is closed; wait for reveal"
    },
    {
      "code": 6060,
      "name": "frontierNotReached",
      "msg": "chunk request margin not reached"
    },
    {
      "code": 6061,
      "name": "wrongSector",
      "msg": "wrong sector account for these coordinates"
    },
    {
      "code": 6062,
      "name": "badGeneration",
      "msg": "VRF request generation mismatch"
    },
    {
      "code": 6063,
      "name": "badChunkState",
      "msg": "chunk is not in the required state"
    },
    {
      "code": 6064,
      "name": "notReconcilable",
      "msg": "delegated/committed state unavailable for reconciliation"
    },
    {
      "code": 6065,
      "name": "badVersion",
      "msg": "account version is unsupported"
    },
    {
      "code": 6066,
      "name": "capacityExceeded",
      "msg": "bounded capacity exceeded"
    }
  ],
  "types": [
    {
      "name": "abilityArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "direction",
            "docs": [
              "Direction for directional abilities (Dash/Ram/Hook/Leap/Phase)."
            ],
            "type": "u8"
          },
          {
            "name": "targetX",
            "docs": [
              "Target tile for placed effects (Trap/TimeSlow/AreaStun/LaneShift)."
            ],
            "type": "u8"
          },
          {
            "name": "targetY",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "abilityKind",
      "docs": [
        "Closed set of ability kinds. Adding one requires a program upgrade —",
        "never client-supplied scripts or arbitrary effect payloads."
      ],
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "none"
          },
          {
            "name": "dash"
          },
          {
            "name": "shield"
          },
          {
            "name": "anchor"
          },
          {
            "name": "ram"
          },
          {
            "name": "hook"
          },
          {
            "name": "leap"
          },
          {
            "name": "trap"
          },
          {
            "name": "phase"
          },
          {
            "name": "swap"
          },
          {
            "name": "laneShift"
          },
          {
            "name": "timeSlow"
          },
          {
            "name": "areaStun"
          }
        ]
      }
    },
    {
      "name": "adminRotated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previous",
            "type": "pubkey"
          },
          {
            "name": "newAdmin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "adminRotationProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "current",
            "type": "pubkey"
          },
          {
            "name": "proposed",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "agentDelisted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "agentListedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "agentLock",
      "docs": [
        "PDA: [\"agent_lock\", world, wallet, attempt_nonce_le]",
        "",
        "Binds asset, owner, world, and attempt. `asset == Pubkey::default()` is",
        "the starter marker (nothing to freeze/thaw)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "world",
            "type": "pubkey"
          },
          {
            "name": "attemptNonce",
            "type": "u32"
          },
          {
            "name": "classId",
            "docs": [
              "Program-derived gameplay class (from the asset's `AssetMap`, or 0 for",
              "the starter). Spawn reads this — never a client-supplied class."
            ],
            "type": "u16"
          },
          {
            "name": "frozen",
            "docs": [
              "True while the Core asset is frozen for this attempt."
            ],
            "type": "bool"
          },
          {
            "name": "unlocked",
            "docs": [
              "Terminal unlock completed (idempotent thaw)."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "agentLockedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "world",
            "type": "pubkey"
          },
          {
            "name": "attemptNonce",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "agentSold",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "sellerAmount",
            "type": "u64"
          },
          {
            "name": "teamAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "agentUnlocked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "world",
            "type": "pubkey"
          },
          {
            "name": "attemptNonce",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "assetMap",
      "docs": [
        "PDA: [\"asset_map\", asset]",
        "Immutable binding written at claim-mint time: the program-owned truth of",
        "which variant/class an asset embodies. Off-chain metadata is display-only."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "season",
            "type": "u16"
          },
          {
            "name": "variantId",
            "type": "u16"
          },
          {
            "name": "classId",
            "type": "u16"
          },
          {
            "name": "rarity",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "attemptActivated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "world",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "attemptNonce",
            "type": "u32"
          },
          {
            "name": "classId",
            "type": "u16"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "x",
            "type": "u8"
          },
          {
            "name": "y",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "attemptEnded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "world",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "attemptNonce",
            "type": "u32"
          },
          {
            "name": "finalScore",
            "type": "u32"
          },
          {
            "name": "reason",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "banner",
      "docs": [
        "PDA: [\"banner\", season_le, tier]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "season",
            "type": "u16"
          },
          {
            "name": "tier",
            "docs": [
              "0 = Standard (5), 1 = Enhanced (10), 2 = Premium (20)."
            ],
            "type": "u8"
          },
          {
            "name": "price",
            "docs": [
              "Price in USDC base units; immutable after season start."
            ],
            "type": "u64"
          },
          {
            "name": "baseWeights",
            "docs": [
              "Base weights [common, rare, epic, legendary], sum 100; immutable",
              "after season start."
            ],
            "type": {
              "array": [
                "u16",
                4
              ]
            }
          },
          {
            "name": "inventoryRevision",
            "docs": [
              "Bumped whenever any variant's availability changes (sold out, pause)."
            ],
            "type": "u32"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "bannerStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "bannerConfigured",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "season",
            "type": "u16"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "price",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "bannerStatus",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "paused"
          }
        ]
      }
    },
    {
      "name": "chunkDefinition",
      "docs": [
        "PDA: [\"chunk\", utc_day_le, chunk_index_le]",
        "One revealed definition is shared by both paid and casual modes."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "region",
            "docs": [
              "Rollup region; regions generate independent maps because a chunk can",
              "only be delegated to one validator at a time."
            ],
            "type": "u8"
          },
          {
            "name": "day",
            "type": "u64"
          },
          {
            "name": "chunkIndex",
            "type": "u32"
          },
          {
            "name": "rowStart",
            "docs": [
              "First absolute row of this chunk (chunk_index * 16)."
            ],
            "type": "u32"
          },
          {
            "name": "rowCount",
            "docs": [
              "Fixed 16."
            ],
            "type": "u8"
          },
          {
            "name": "generation",
            "docs": [
              "VRF request generation this chunk was revealed under."
            ],
            "type": "u16"
          },
          {
            "name": "randomnessHash",
            "docs": [
              "Commitment to the raw randomness for auditability."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "generationVersion",
            "docs": [
              "Deterministic generator version."
            ],
            "type": "u16"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "chunkStatus"
              }
            }
          },
          {
            "name": "requestedAt",
            "type": "i64"
          },
          {
            "name": "lanes",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "lane"
                  }
                },
                16
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "chunkReady",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "world",
            "type": "pubkey"
          },
          {
            "name": "chunkIndex",
            "type": "u32"
          },
          {
            "name": "randomnessHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "chunkRequestState",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "idle"
          },
          {
            "name": "requested"
          }
        ]
      }
    },
    {
      "name": "chunkRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "day",
            "type": "u64"
          },
          {
            "name": "chunkIndex",
            "type": "u32"
          },
          {
            "name": "generation",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "chunkRevealed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "day",
            "type": "u64"
          },
          {
            "name": "chunkIndex",
            "type": "u32"
          },
          {
            "name": "generation",
            "type": "u16"
          },
          {
            "name": "randomnessHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "chunkStatus",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "uninitialized"
          },
          {
            "name": "requested"
          },
          {
            "name": "revealed"
          },
          {
            "name": "closed"
          }
        ]
      }
    },
    {
      "name": "classConfig",
      "docs": [
        "PDA: [\"class\", class_id_le, version_le]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "classId",
            "type": "u16"
          },
          {
            "name": "version",
            "type": "u16"
          },
          {
            "name": "ability",
            "type": {
              "defined": {
                "name": "abilityKind"
              }
            }
          },
          {
            "name": "cooldownSeconds",
            "docs": [
              "Fixed cooldown 10..=30 seconds."
            ],
            "type": "u16"
          },
          {
            "name": "range",
            "docs": [
              "Targeting range in tiles (bounded by MAX_ABILITY_RANGE)."
            ],
            "type": "u8"
          },
          {
            "name": "durationSeconds",
            "docs": [
              "Effect duration seconds (bounded by MAX_EFFECT_DURATION_SECONDS)."
            ],
            "type": "u16"
          },
          {
            "name": "displacement",
            "docs": [
              "Displacement magnitude in tiles for push/pull/dash kinds."
            ],
            "type": "u8"
          },
          {
            "name": "paramA",
            "docs": [
              "Bounded kind-specific parameters (e.g. slow permille, stun ms)."
            ],
            "type": "u16"
          },
          {
            "name": "paramB",
            "type": "u16"
          },
          {
            "name": "minRarity",
            "docs": [
              "Minimum rarity allowed to reference this class (pay-to-win is",
              "intentional and disclosed)."
            ],
            "type": "u8"
          },
          {
            "name": "activationDay",
            "docs": [
              "UTC day at which this version activates (future day boundary only)."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "classConfigured",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "classId",
            "type": "u16"
          },
          {
            "name": "version",
            "type": "u16"
          },
          {
            "name": "activationDay",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "configInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "collection",
            "type": "pubkey"
          },
          {
            "name": "validator",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "dailyBest",
      "docs": [
        "PDA: [\"best\", world, wallet]",
        "Every wallet writes its own best account; indexers sort them for pages.",
        "The prize record itself lives in `WorldHeader`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "world",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "bestScore",
            "type": "u32"
          },
          {
            "name": "attemptNonce",
            "type": "u32"
          },
          {
            "name": "reachedSlot",
            "type": "u64"
          },
          {
            "name": "classId",
            "type": "u16"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "dailyCompetition",
      "docs": [
        "PDA: [\"daily\", utc_day_le]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "region",
            "docs": [
              "Rollup region; each region runs an independent competition and pot."
            ],
            "type": "u8"
          },
          {
            "name": "day",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "dayStatus"
              }
            }
          },
          {
            "name": "paidWorld",
            "docs": [
              "Paid world PDA (delegated gameplay root)."
            ],
            "type": "pubkey"
          },
          {
            "name": "casualWorld",
            "docs": [
              "Casual world PDA."
            ],
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "Canonical day vault token account (owned by the vault authority PDA)."
            ],
            "type": "pubkey"
          },
          {
            "name": "vaultAuthorityBump",
            "type": "u8"
          },
          {
            "name": "rolloverIn",
            "docs": [
              "Rollover received from the previous day (part of active pool)."
            ],
            "type": "u64"
          },
          {
            "name": "rolloverOut",
            "docs": [
              "Rollover paid forward after a no-winner day."
            ],
            "type": "u64"
          },
          {
            "name": "pendingTotal",
            "docs": [
              "Payments received but not yet reconciled to an ER outcome."
            ],
            "type": "u64"
          },
          {
            "name": "activePool",
            "docs": [
              "Consumed entries/revivals forming the day's prize pool",
              "(includes rollover_in once opened)."
            ],
            "type": "u64"
          },
          {
            "name": "refundLiability",
            "docs": [
              "Refundable receipts + void-day contributions awaiting claims."
            ],
            "type": "u64"
          },
          {
            "name": "winnerUnpaid",
            "docs": [
              "Fixed winner obligation after finalize (unpaid leg)."
            ],
            "type": "u64"
          },
          {
            "name": "teamUnpaid",
            "docs": [
              "Fixed team obligation after finalize (unpaid leg)."
            ],
            "type": "u64"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "totalRefunded",
            "type": "u64"
          },
          {
            "name": "totalSettled",
            "type": "u64"
          },
          {
            "name": "settledWinner",
            "type": "pubkey"
          },
          {
            "name": "settledScore",
            "type": "u32"
          },
          {
            "name": "winnerAmount",
            "type": "u64"
          },
          {
            "name": "teamAmount",
            "type": "u64"
          },
          {
            "name": "winnerPaid",
            "type": "bool"
          },
          {
            "name": "teamPaid",
            "type": "bool"
          },
          {
            "name": "rolloverConsumed",
            "docs": [
              "Set once the rollover was consumed into a successor day."
            ],
            "type": "bool"
          },
          {
            "name": "finalCommitSlot",
            "docs": [
              "Slot at which the final world record commit was observed on base."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "dailyContribution",
      "docs": [
        "PDA: [\"contribution\", utc_day_le, wallet]",
        "Makes void refunds independent and idempotent per wallet without an",
        "unbounded payer list in `DailyCompetition`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "day",
            "type": "u64"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "entryTotal",
            "docs": [
              "Consumed (activated) entry payments."
            ],
            "type": "u64"
          },
          {
            "name": "revivalTotal",
            "docs": [
              "Consumed (activated) revival payments."
            ],
            "type": "u64"
          },
          {
            "name": "refundedTotal",
            "docs": [
              "Already refunded on a voided day."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "dayClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "day",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "dayCommitted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "day",
            "type": "u64"
          },
          {
            "name": "recordScore",
            "type": "u32"
          },
          {
            "name": "recordHolder",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "dayOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "day",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "dayPrepared",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "day",
            "type": "u64"
          },
          {
            "name": "rolloverIn",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "daySettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "day",
            "type": "u64"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "winnerAmount",
            "type": "u64"
          },
          {
            "name": "teamAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "dayStatus",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "prepared"
          },
          {
            "name": "open"
          },
          {
            "name": "closed"
          },
          {
            "name": "committed"
          },
          {
            "name": "settled"
          },
          {
            "name": "voided"
          }
        ]
      }
    },
    {
      "name": "dayVoided",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "day",
            "type": "u64"
          },
          {
            "name": "refundLiability",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "frontierExtended",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "world",
            "type": "pubkey"
          },
          {
            "name": "day",
            "type": "u64"
          },
          {
            "name": "mode",
            "type": {
              "defined": {
                "name": "worldMode"
              }
            }
          },
          {
            "name": "mapSeq",
            "type": "u64"
          },
          {
            "name": "chunkIndex",
            "type": "u32"
          },
          {
            "name": "generation",
            "type": "u16"
          },
          {
            "name": "revealedRows",
            "type": "u32"
          },
          {
            "name": "randomnessHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "gachaPull",
      "docs": [
        "PDA: [\"pull\", player, pull_nonce_le]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "season",
            "type": "u16"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "pullNonce",
            "type": "u32"
          },
          {
            "name": "price",
            "docs": [
              "Exact USDC price paid (held in the gacha vault until terminal)."
            ],
            "type": "u64"
          },
          {
            "name": "effectiveWeights",
            "docs": [
              "Snapshot of effective weights shown before payment."
            ],
            "type": {
              "array": [
                "u16",
                4
              ]
            }
          },
          {
            "name": "epicMissesSnapshot",
            "docs": [
              "Snapshot of pity counters at request time."
            ],
            "type": "u16"
          },
          {
            "name": "legendaryMissesSnapshot",
            "type": "u16"
          },
          {
            "name": "requestedAt",
            "type": "i64"
          },
          {
            "name": "requestGeneration",
            "docs": [
              "VRF request generation; a refund invalidates the generation and a",
              "late callback from an older generation must fail."
            ],
            "type": "u16"
          },
          {
            "name": "randomness",
            "docs": [
              "Set only by an authenticated MagicBlock VRF callback."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "pullState"
              }
            }
          },
          {
            "name": "assignedRarity",
            "type": "u8"
          },
          {
            "name": "assignedVariant",
            "type": "u16"
          },
          {
            "name": "inventoryReserved",
            "docs": [
              "True while one supply unit is reserved and unminted."
            ],
            "type": "bool"
          },
          {
            "name": "mintedAsset",
            "docs": [
              "Minted Core asset (set on claim)."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "globalConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "V1 single admin (two-step rotation to allow future multisig handoff)."
            ],
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "docs": [
              "Pending admin of an in-flight rotation (None when idle)."
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "usdcMint",
            "docs": [
              "Canonical USDC mint. Every USDC account is checked against it."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "docs": [
              "Supported SPL token program for the canonical mint."
            ],
            "type": "pubkey"
          },
          {
            "name": "teamTreasury",
            "docs": [
              "Team treasury USDC token account (settlement + royalties + gacha)."
            ],
            "type": "pubkey"
          },
          {
            "name": "collection",
            "docs": [
              "Verified Metaplex Core collection for agent assets."
            ],
            "type": "pubkey"
          },
          {
            "name": "collectionAuthority",
            "docs": [
              "Update authority configured for the collection."
            ],
            "type": "pubkey"
          },
          {
            "name": "validators",
            "docs": [
              "MagicBlock validator per region; `Pubkey::default()` = region closed.",
              "",
              "Indexed by the region id in the world PDA, so a world can only ever be",
              "delegated to the validator its own region names. A single field would",
              "have let any world land on any rollup, which is how a European world",
              "ends up hosted in Singapore and the whole point is lost."
            ],
            "type": {
              "array": [
                "pubkey",
                4
              ]
            }
          },
          {
            "name": "pauseFlags",
            "docs": [
              "Pause bitmask (see `pause`)."
            ],
            "type": "u16"
          },
          {
            "name": "winnerBps",
            "docs": [
              "Winner basis points: 9000."
            ],
            "type": "u16"
          },
          {
            "name": "teamBps",
            "docs": [
              "Team basis points: 1000."
            ],
            "type": "u16"
          },
          {
            "name": "maxPaidPlayers",
            "docs": [
              "Maximum concurrent paid players (<= HARD_MAX_PLAYERS)."
            ],
            "type": "u16"
          },
          {
            "name": "maxCasualPlayers",
            "docs": [
              "Maximum concurrent casual players (<= HARD_MAX_PLAYERS)."
            ],
            "type": "u16"
          },
          {
            "name": "version",
            "docs": [
              "Configuration version for upgrade compatibility."
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "identitySet",
      "docs": [
        "A player set or changed their display identity."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "lane",
      "docs": [
        "Borsh-friendly lane mirror of the kernel `LaneDescriptor`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "dirPositive",
            "type": "u8"
          },
          {
            "name": "footprint",
            "type": "u8"
          },
          {
            "name": "gapTiles",
            "type": "u8"
          },
          {
            "name": "speedMtps",
            "type": "u16"
          },
          {
            "name": "phaseMt",
            "type": "u32"
          },
          {
            "name": "warningMs",
            "type": "u32"
          },
          {
            "name": "periodMs",
            "type": "u32"
          },
          {
            "name": "blockerMask",
            "type": "u64"
          },
          {
            "name": "sinking",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "listingStatus",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "sold"
          },
          {
            "name": "delisted"
          }
        ]
      }
    },
    {
      "name": "marketplaceListing",
      "docs": [
        "PDA: [\"listing\", asset]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "price",
            "docs": [
              "Nonzero USDC base units."
            ],
            "type": "u64"
          },
          {
            "name": "createdTs",
            "type": "i64"
          },
          {
            "name": "expiryTs",
            "docs": [
              "0 = no expiry."
            ],
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "listingStatus"
              }
            }
          },
          {
            "name": "saleNonce",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "occupancySector",
      "docs": [
        "PDA: [\"sector\", world, sector_x, sector_y_le]",
        "8x8 tiles; occupancy + static blockers as bitsets, bounded effect slots."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "world",
            "type": "pubkey"
          },
          {
            "name": "sectorX",
            "type": "u8"
          },
          {
            "name": "sectorY",
            "type": "u32"
          },
          {
            "name": "occupancy",
            "docs": [
              "One bit per tile (bit = local_y * 8 + local_x). One live player per",
              "tile, enforced atomically by movement/spawn/displacement handlers."
            ],
            "type": "u64"
          },
          {
            "name": "blockers",
            "docs": [
              "Static blockers derived from the revealed chunk rows."
            ],
            "type": "u64"
          },
          {
            "name": "seq",
            "docs": [
              "Monotonic sequence for client gap detection."
            ],
            "type": "u64"
          },
          {
            "name": "effects",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "tempEffect"
                  }
                },
                8
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "pauseChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "scope",
            "type": "u8"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "paymentConsumed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "paymentPending",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "day",
            "type": "u64"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "attemptNonce",
            "type": "u32"
          },
          {
            "name": "deathNonce",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "paymentReceipt",
      "docs": [
        "PDA: [\"payment\", kind, day_le, wallet, receipt_nonce_le]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "receiptKind"
              }
            }
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "receiptState"
              }
            }
          },
          {
            "name": "day",
            "type": "u64"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "run",
            "docs": [
              "The PlayerRun this payment is bound to."
            ],
            "type": "pubkey"
          },
          {
            "name": "attemptNonce",
            "type": "u32"
          },
          {
            "name": "deathNonce",
            "docs": [
              "Revival only: the exact death this payment revives."
            ],
            "type": "u32"
          },
          {
            "name": "reviveIndex",
            "docs": [
              "Revival only: successful revive count at purchase (prices the leg)."
            ],
            "type": "u16"
          },
          {
            "name": "amount",
            "docs": [
              "Exact USDC amount moved into the vault."
            ],
            "type": "u64"
          },
          {
            "name": "createdTs",
            "type": "i64"
          },
          {
            "name": "receiptNonce",
            "docs": [
              "Wallet-scoped receipt nonce (from PlayerProfile counter or run state)."
            ],
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "paymentRefundable",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "paymentRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "payoutLegCompleted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "day",
            "type": "u64"
          },
          {
            "name": "leg",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "destination",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "pityPair",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epicMisses",
            "type": "u16"
          },
          {
            "name": "legendaryMisses",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "playerDied",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "world",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "attemptNonce",
            "type": "u32"
          },
          {
            "name": "deathNonce",
            "type": "u32"
          },
          {
            "name": "cause",
            "type": "u8"
          },
          {
            "name": "x",
            "type": "u8"
          },
          {
            "name": "y",
            "type": "u32"
          },
          {
            "name": "reviveDeadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "playerIdentity",
      "docs": [
        "A player's chosen display identity.",
        "",
        "Separate from `PlayerProfile` on purpose: profiles already exist on",
        "chain, and widening a live account would strand every one of them. This",
        "is additive — a wallet without one is simply anonymous, drawn from its",
        "address like before.",
        "",
        "PDA: [\"identity\", wallet]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "name",
            "docs": [
              "Sanitised ASCII, `name_len` bytes significant. Never unique: the",
              "wallet identifies a player, this only labels them."
            ],
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "nameLen",
            "type": "u8"
          },
          {
            "name": "agent",
            "docs": [
              "Cosmetic agent the player picked, so everyone draws them the same."
            ],
            "type": "u16"
          },
          {
            "name": "version",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "playerProfile",
      "docs": [
        "PDA: [\"player\", wallet]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "starterClaimed",
            "docs": [
              "One-time non-transferable starter entitlement."
            ],
            "type": "bool"
          },
          {
            "name": "pity",
            "docs": [
              "Per-banner-tier pity counters [standard, enhanced, premium]; carry",
              "across seasons."
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "pityPair"
                  }
                },
                3
              ]
            }
          },
          {
            "name": "pullCount",
            "docs": [
              "Sequential nonce for gacha pull PDAs."
            ],
            "type": "u32"
          },
          {
            "name": "pendingPull",
            "docs": [
              "The only unresolved pull for this wallet. Serializing pulls is what",
              "makes pity snapshots exact instead of allowing parallel requests to",
              "reuse the same counters."
            ],
            "type": "pubkey"
          },
          {
            "name": "receiptCount",
            "docs": [
              "Sequential nonce for payment receipt PDAs."
            ],
            "type": "u32"
          },
          {
            "name": "totalPaidWins",
            "docs": [
              "Authoritative daily wins, all time."
            ],
            "type": "u32"
          },
          {
            "name": "seasonWins",
            "docs": [
              "Wins in `wins_season`."
            ],
            "type": "u32"
          },
          {
            "name": "winsSeason",
            "type": "u16"
          },
          {
            "name": "highestPaidScore",
            "type": "u32"
          },
          {
            "name": "highestCasualScore",
            "type": "u32"
          },
          {
            "name": "completedAttempts",
            "type": "u32"
          },
          {
            "name": "totalSuccessfulRevives",
            "type": "u32"
          },
          {
            "name": "version",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "playerRevived",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "world",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "attemptNonce",
            "type": "u32"
          },
          {
            "name": "deathNonce",
            "type": "u32"
          },
          {
            "name": "reviveCount",
            "type": "u16"
          },
          {
            "name": "x",
            "type": "u8"
          },
          {
            "name": "y",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "playerRun",
      "docs": [
        "PDA: [\"run\", world, wallet]",
        "One account per wallet per world, reused across attempts by incrementing",
        "`attempt_nonce`. Never two active attempts simultaneously."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "world",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "sessionAuthority",
            "docs": [
              "Registered session signer for gameplay actions."
            ],
            "type": "pubkey"
          },
          {
            "name": "sessionExpiry",
            "type": "i64"
          },
          {
            "name": "sessionScope",
            "type": "u8"
          },
          {
            "name": "sessionRotation",
            "docs": [
              "Rate limit + binding for session rotation."
            ],
            "type": "u16"
          },
          {
            "name": "attemptNonce",
            "type": "u32"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "runState"
              }
            }
          },
          {
            "name": "agentAsset",
            "docs": [
              "Selected Core asset; Pubkey::default() = starter marker."
            ],
            "type": "pubkey"
          },
          {
            "name": "classId",
            "type": "u16"
          },
          {
            "name": "classVersion",
            "type": "u16"
          },
          {
            "name": "x",
            "type": "u8"
          },
          {
            "name": "y",
            "type": "u32"
          },
          {
            "name": "facing",
            "docs": [
              "Facing direction (grid::Direction as u8), updated by accepted moves."
            ],
            "type": "u8"
          },
          {
            "name": "score",
            "docs": [
              "Furthest forward row = authoritative score for this attempt."
            ],
            "type": "u32"
          },
          {
            "name": "safeX",
            "docs": [
              "Last verified safe tile (revival placement policy)."
            ],
            "type": "u8"
          },
          {
            "name": "safeY",
            "type": "u32"
          },
          {
            "name": "lastMoveSlot",
            "docs": [
              "One accepted movement per ER slot."
            ],
            "type": "u64"
          },
          {
            "name": "actionSeq",
            "docs": [
              "Exact-next action sequence; consumed by successfully executed actions."
            ],
            "type": "u64"
          },
          {
            "name": "stateSeq",
            "docs": [
              "Monotonic sequence for every authoritative run mutation, including",
              "changes that do not consume a player action."
            ],
            "type": "u64"
          },
          {
            "name": "kickReadyTs",
            "type": "i64"
          },
          {
            "name": "abilityReadyTs",
            "type": "i64"
          },
          {
            "name": "stunnedUntil",
            "type": "i64"
          },
          {
            "name": "slowedUntil",
            "type": "i64"
          },
          {
            "name": "shieldUntil",
            "docs": [
              "Guardian shield: absorbs one environmental collision until expiry."
            ],
            "type": "i64"
          },
          {
            "name": "shieldCharges",
            "type": "u8"
          },
          {
            "name": "anchorUntil",
            "docs": [
              "Anchor: ignores forced movement until expiry."
            ],
            "type": "i64"
          },
          {
            "name": "successfulRevives",
            "type": "u16"
          },
          {
            "name": "deathNonce",
            "type": "u32"
          },
          {
            "name": "reviveDeadline",
            "type": "i64"
          },
          {
            "name": "entryReceipt",
            "docs": [
              "Receipt PDAs currently bound to this attempt (entry / latest revival)."
            ],
            "type": "pubkey"
          },
          {
            "name": "reviveReceipt",
            "type": "pubkey"
          },
          {
            "name": "hazardNonce",
            "docs": [
              "Hazard scheduling: stale-nonce protection for crank checks."
            ],
            "type": "u32"
          },
          {
            "name": "hazardDeadlineMs",
            "docs": [
              "Next scheduled hazard deadline in ms since world start (0 = none)."
            ],
            "type": "u64"
          },
          {
            "name": "lastCommittedState",
            "docs": [
              "Reconciliation markers: committed state observed by base instructions."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "pullAssigned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pull",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "rarity",
            "type": "u8"
          },
          {
            "name": "variantId",
            "type": "u16"
          },
          {
            "name": "epicPityAfter",
            "type": "u16"
          },
          {
            "name": "legendaryPityAfter",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "pullClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pull",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "variantId",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "pullRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pull",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pullRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pull",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "season",
            "type": "u16"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "pullNonce",
            "type": "u32"
          },
          {
            "name": "price",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pullState",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pending"
          },
          {
            "name": "randomnessReady"
          },
          {
            "name": "assigned"
          },
          {
            "name": "claimed"
          },
          {
            "name": "refundable"
          },
          {
            "name": "refunded"
          }
        ]
      }
    },
    {
      "name": "rarityPool",
      "docs": [
        "PDA: [\"rarity_pool\", season_le, rarity]. A compact canonical catalog",
        "lets a gacha assignment select from one bounded account after VRF",
        "fulfillment; callback transactions never need hundreds of variant keys."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "season",
            "type": "u16"
          },
          {
            "name": "rarity",
            "type": "u8"
          },
          {
            "name": "count",
            "type": "u16"
          },
          {
            "name": "revision",
            "docs": [
              "Monotonic reservation counter for auditing and indexer cache busting."
            ],
            "type": "u32"
          },
          {
            "name": "initialized",
            "type": "bool"
          },
          {
            "name": "entries",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "rarityPoolEntry"
                  }
                },
                64
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "rarityPoolEntry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "variantId",
            "type": "u16"
          },
          {
            "name": "available",
            "docs": [
              "Units not yet assigned. Reservations are removed here atomically with",
              "the corresponding `VariantInventory.reserved` increment."
            ],
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "receiptKind",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "entry"
          },
          {
            "name": "revival"
          }
        ]
      }
    },
    {
      "name": "receiptState",
      "docs": [
        "Receipt terminal-state machine:",
        "`Pending -> Consumed` XOR `Pending -> Refundable -> Refunded`."
      ],
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pending"
          },
          {
            "name": "consumed"
          },
          {
            "name": "refundable"
          },
          {
            "name": "refunded"
          }
        ]
      }
    },
    {
      "name": "recordChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "world",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "attemptNonce",
            "type": "u32"
          },
          {
            "name": "score",
            "type": "u32"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "rolloverConsumed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "intoDay",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "rolloverCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fromDay",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "runState",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "idle"
          },
          {
            "name": "pendingSpawn"
          },
          {
            "name": "active"
          },
          {
            "name": "deadAwaitingRevive"
          },
          {
            "name": "entryFailed"
          },
          {
            "name": "ended"
          }
        ]
      }
    },
    {
      "name": "season",
      "docs": [
        "PDA: [\"season\", season_index_le]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seasonIndex",
            "type": "u16"
          },
          {
            "name": "startDay",
            "docs": [
              "Inclusive start day."
            ],
            "type": "u64"
          },
          {
            "name": "endDay",
            "docs": [
              "Exclusive end day (start + 30)."
            ],
            "type": "u64"
          },
          {
            "name": "weightsHash",
            "docs": [
              "Hash over the immutable banner base weights (auditable immutability)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "classBalanceVersion",
            "docs": [
              "Class-balance version snapshot for this season."
            ],
            "type": "u16"
          },
          {
            "name": "metadataVersion",
            "docs": [
              "Metadata base URI version."
            ],
            "type": "u16"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "seasonStatus"
              }
            }
          },
          {
            "name": "variantCount",
            "docs": [
              "Number of registered variants (bounded by MAX_SEASON_VARIANTS)."
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "seasonActivated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "season",
            "type": "u16"
          },
          {
            "name": "weightsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "variantCount",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "seasonConfigured",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "season",
            "type": "u16"
          },
          {
            "name": "startDay",
            "type": "u64"
          },
          {
            "name": "endDay",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "seasonStatus",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "configured"
          },
          {
            "name": "active"
          },
          {
            "name": "closed"
          },
          {
            "name": "paused"
          }
        ]
      }
    },
    {
      "name": "starterClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "tempEffect",
      "docs": [
        "Bounded temporary effect stored in a sector. Expired slots are reusable;",
        "full slots reject new effects rather than evicting unpredictably."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kind",
            "docs": [
              "0 = empty slot. Mirrors AbilityKind for placed effects."
            ],
            "type": "u8"
          },
          {
            "name": "centerX",
            "type": "u8"
          },
          {
            "name": "centerY",
            "type": "u32"
          },
          {
            "name": "radius",
            "type": "u8"
          },
          {
            "name": "magnitude",
            "docs": [
              "e.g. slow permille for Trap/TimeSlow, unused otherwise."
            ],
            "type": "u16"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "source",
            "docs": [
              "Originating run (kick/ability attribution for UI; no kill credit)."
            ],
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "validatorChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "region",
            "type": "u8"
          },
          {
            "name": "previous",
            "type": "pubkey"
          },
          {
            "name": "validator",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "variantConfigured",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "season",
            "type": "u16"
          },
          {
            "name": "variantId",
            "type": "u16"
          },
          {
            "name": "classId",
            "type": "u16"
          },
          {
            "name": "rarity",
            "type": "u8"
          },
          {
            "name": "supplyCap",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "variantInventory",
      "docs": [
        "PDA: [\"variant\", season_le, variant_id_le]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "season",
            "type": "u16"
          },
          {
            "name": "variantId",
            "type": "u16"
          },
          {
            "name": "classId",
            "docs": [
              "Gameplay class this variant maps to (program-owned truth)."
            ],
            "type": "u16"
          },
          {
            "name": "rarity",
            "docs": [
              "Rarity 0..=3."
            ],
            "type": "u8"
          },
          {
            "name": "modelId",
            "docs": [
              "Voxel model identifier (asset manifest key)."
            ],
            "type": "u16"
          },
          {
            "name": "cosmeticId",
            "docs": [
              "Cosmetic variant identifier."
            ],
            "type": "u16"
          },
          {
            "name": "metadataUriHash",
            "docs": [
              "Hash of the metadata URI template for this variant."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "supplyCap",
            "docs": [
              "Seasonal mint cap; immutable after season start."
            ],
            "type": "u32"
          },
          {
            "name": "reserved",
            "docs": [
              "Assigned-but-unminted reservations."
            ],
            "type": "u32"
          },
          {
            "name": "minted",
            "docs": [
              "Successfully minted count. reserved + minted <= supply_cap."
            ],
            "type": "u32"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "voidRefundClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "day",
            "type": "u64"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "worldHeader",
      "docs": [
        "PDA: [\"world\", mode, utc_day_le]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "region",
            "docs": [
              "Rollup region this world runs on; part of its own PDA seeds."
            ],
            "type": "u8"
          },
          {
            "name": "day",
            "type": "u64"
          },
          {
            "name": "mode",
            "type": {
              "defined": {
                "name": "worldMode"
              }
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "worldStatus"
              }
            }
          },
          {
            "name": "startTs",
            "docs": [
              "Authoritative day window (derived from `day`, stored for cheap checks)."
            ],
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "width",
            "docs": [
              "Fixed 64."
            ],
            "type": "u8"
          },
          {
            "name": "safeRows",
            "docs": [
              "Safe-zone rows [0, safe_rows)."
            ],
            "type": "u16"
          },
          {
            "name": "activePlayers",
            "type": "u16"
          },
          {
            "name": "playerCap",
            "type": "u16"
          },
          {
            "name": "revealedRows",
            "docs": [
              "Number of revealed rows; the frontier. Movement at/above this row is",
              "rejected (fail closed at an unrevealed boundary)."
            ],
            "type": "u32"
          },
          {
            "name": "mapSeq",
            "docs": [
              "Monotonic sequence for visible map changes. Clients use this to",
              "detect dropped frontier notifications and refetch a snapshot."
            ],
            "type": "u64"
          },
          {
            "name": "latestChunkIndex",
            "docs": [
              "Exact immutable chunk currently terminating the visible frontier."
            ],
            "type": "u32"
          },
          {
            "name": "latestChunkGeneration",
            "type": "u16"
          },
          {
            "name": "latestChunkHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "readyChunkIndex",
            "docs": [
              "A non-zero index means all sectors for that next chunk were observed",
              "together on this ER and the frontier may advance over it."
            ],
            "type": "u32"
          },
          {
            "name": "readyChunkHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "spawnReady",
            "docs": [
              "The spawn chunk and all of its sectors have been observed together on",
              "this world's ER. No attempt may activate before this barrier is set."
            ],
            "type": "bool"
          },
          {
            "name": "recordScore",
            "docs": [
              "Current record: score, holder, attempt, slot. The ONLY prize authority."
            ],
            "type": "u32"
          },
          {
            "name": "recordHolder",
            "type": "pubkey"
          },
          {
            "name": "recordAttempt",
            "type": "u32"
          },
          {
            "name": "recordSlot",
            "type": "u64"
          },
          {
            "name": "nextChunkIndex",
            "docs": [
              "Chunk pipeline: index the next request will target and its state."
            ],
            "type": "u32"
          },
          {
            "name": "chunkRequestState",
            "type": {
              "defined": {
                "name": "chunkRequestState"
              }
            }
          },
          {
            "name": "chunkGeneration",
            "docs": [
              "VRF request generation for the in-flight chunk request."
            ],
            "type": "u16"
          },
          {
            "name": "chunkRequestedAt",
            "type": "i64"
          },
          {
            "name": "classBalanceVersion",
            "docs": [
              "Class-balance version snapshotted at preparation."
            ],
            "type": "u16"
          },
          {
            "name": "actionDomain",
            "docs": [
              "Domain for action-envelope uniqueness."
            ],
            "type": "u64"
          },
          {
            "name": "commitPayer",
            "docs": [
              "Authorized commit/crank fee payer reference."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "worldMode",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "paid"
          },
          {
            "name": "casual"
          }
        ]
      }
    },
    {
      "name": "worldStatus",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "prepared"
          },
          {
            "name": "open"
          },
          {
            "name": "closed"
          }
        ]
      }
    }
  ]
};
