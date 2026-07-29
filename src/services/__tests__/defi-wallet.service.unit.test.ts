jest.mock("axios", () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

jest.mock("../../models/wallet.model", () => ({
  WalletModel: {
    findByUserId: jest.fn(),
  },
}));

jest.mock("../cache.service", () => ({
  CacheService: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

jest.mock("../stellar.service", () => ({
  stellarService: {
    getAccount: jest.fn(),
  },
}));

import axios from "axios";
import { WalletModel } from "../../models/wallet.model";
import { CacheService } from "../cache.service";
import { stellarService } from "../stellar.service";
import { DeFiWalletService } from "../defi-wallet.service";

const axiosPost = axios.post as jest.Mock;
const findByUserId = WalletModel.findByUserId as jest.Mock;
const cacheGet = CacheService.get as jest.Mock;
const cacheSet = CacheService.set as jest.Mock;
const getAccount = stellarService.getAccount as jest.Mock;

describe("DeFiWalletService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.DEFI_WALLET_USE_MOCKS;
    delete process.env.APP_ENV;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns cached positions without re-syncing", async () => {
    const service = new DeFiWalletService();
    const cachedPositions = [
      {
        userId: "user-1",
        protocol: "Aave",
        chain: "ethereum",
        asset: "USDC",
        amount: "25.00",
        apy: 4.1,
        value: "25.00",
        rewards: "0.00",
        riskScore: 18,
      },
    ];

    cacheGet.mockResolvedValueOnce(cachedPositions);

    await expect(service.getUserPositions("user-1")).resolves.toEqual(
      cachedPositions,
    );
    expect(findByUserId).not.toHaveBeenCalled();
  });

  it("syncs real multi-chain positions and caches them for 10 minutes", async () => {
    const service = new DeFiWalletService();

    findByUserId.mockResolvedValueOnce({
      user_id: "user-1",
      stellar_public_key: "GDUMMYSTELLARADDRESS",
      ethereum_address: "0x1111111111111111111111111111111111111111",
      polygon_address: "0x2222222222222222222222222222222222222222",
      status: "active",
    });

    getAccount.mockResolvedValueOnce({
      balances: [
        {
          assetType: "liquidity_pool_shares",
          balance: "12.5000000",
          liquidityPoolId: "abcdef1234567890",
        },
      ],
    });

    axiosPost
      .mockResolvedValueOnce({
        data: {
          data: {
            userReserves: [
              {
                currentATokenBalance: "10",
                currentATokenBalanceUSD: "10",
                reserve: {
                  symbol: "USDC",
                  liquidityRate: "0.05",
                },
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            account: {
              tokens: [
                {
                  symbol: "WETH",
                  supplyBalanceUnderlying: "1.25",
                  supplyBalanceUnderlyingUSD: "2500",
                  rewardsAccrued: "0.15",
                  market: {
                    supplyRate: "0.02",
                  },
                },
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            userReserves: [],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            account: {
              tokens: [],
            },
          },
        },
      });

    process.env.DEFI_ETHEREUM_AAVE_SUBGRAPH_URL =
      "https://graph.example/aave-eth";
    process.env.DEFI_ETHEREUM_COMPOUND_SUBGRAPH_URL =
      "https://graph.example/compound-eth";
    process.env.DEFI_POLYGON_AAVE_SUBGRAPH_URL =
      "https://graph.example/aave-polygon";
    process.env.DEFI_POLYGON_COMPOUND_SUBGRAPH_URL =
      "https://graph.example/compound-polygon";

    const positions = await service.syncPositions("user-1");

    expect(positions).toHaveLength(3);
    expect(positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protocol: "Aave",
          chain: "ethereum",
          asset: "USDC",
        }),
        expect.objectContaining({
          protocol: "Compound",
          chain: "ethereum",
          asset: "WETH",
        }),
        expect.objectContaining({
          protocol: "Stellar AMM",
          chain: "stellar",
        }),
      ]),
    );
    expect(cacheSet).toHaveBeenCalledWith(
      "defi:positions:user-1",
      positions,
      600,
    );
  });
});
