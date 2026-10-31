import { Test, TestingModule } from '@nestjs/testing';
import { RevenueCatApiService } from './RevenueCatApi.service';
import { HttpService } from '@nestjs/axios/dist';

describe('RevenueCatApiService', () => {
  let service: RevenueCatApiService;
  let httpService: any;

  beforeEach(async () => {
    httpService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RevenueCatApiService,
        {
          provide: HttpService,
          useValue: httpService,
        },
      ],
    }).compile();

    service = module.get<RevenueCatApiService>(RevenueCatApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('subscriberIsPremiumInRevenueCat', () => {
    it('should return true when user has active subscriptions in Google', async () => {
      httpService.get
        .mockReturnValueOnce({
          toPromise: () =>
            Promise.resolve({
              data: {
                subscriber: {
                  subscriptions: {
                    premium_monthly: { id: 'sub_123' },
                  },
                },
              },
            }),
        } as any)
        .mockReturnValueOnce({
          toPromise: () =>
            Promise.resolve({
              data: {
                subscriber: {
                  subscriptions: {},
                },
              },
            }),
        } as any);

      const result = await service.subscriberIsPremiumInRevenueCat('user-123');

      expect(result).toBe(true);
      expect(httpService.get).toHaveBeenCalledTimes(2);
      expect(httpService.get).toHaveBeenNthCalledWith(
        1,
        'https://api.revenuecat.com/v1/subscribers/user-123',
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Platform': 'android' }),
        }),
      );
      expect(httpService.get).toHaveBeenNthCalledWith(
        2,
        'https://api.revenuecat.com/v1/subscribers/user-123',
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Platform': 'ios' }),
        }),
      );
    });

    it('should return true when user has active subscriptions in Apple', async () => {
      httpService.get
        .mockReturnValueOnce({
          toPromise: () =>
            Promise.resolve({
              data: {
                subscriber: {
                  subscriptions: {},
                },
              },
            }),
        } as any)
        .mockReturnValueOnce({
          toPromise: () =>
            Promise.resolve({
              data: {
                subscriber: {
                  subscriptions: {
                    apple_annual: { id: 'apple_sub_456' },
                  },
                },
              },
            }),
        } as any);

      const result = await service.subscriberIsPremiumInRevenueCat('user-123');

      expect(result).toBe(true);
      expect(httpService.get).toHaveBeenCalledTimes(2);
    });

    it('should return false when user has empty subscriptions on both platforms', async () => {
      httpService.get
        .mockReturnValueOnce({
          toPromise: () =>
            Promise.resolve({
              data: {
                subscriber: {
                  subscriptions: {},
                },
              },
            }),
        } as any)
        .mockReturnValueOnce({
          toPromise: () =>
            Promise.resolve({
              data: {
                subscriber: {
                  subscriptions: {},
                },
              },
            }),
        } as any);

      const result = await service.subscriberIsPremiumInRevenueCat('user-123');

      expect(result).toBe(false);
      expect(httpService.get).toHaveBeenCalledTimes(2);
    });

    it('should propagate error when httpService fails', async () => {
      httpService.get.mockReturnValueOnce({
        toPromise: () =>
          Promise.reject(new Error('RevenueCat API network timeout')),
      } as any);

      await expect(
        service.subscriberIsPremiumInRevenueCat('user-123'),
      ).rejects.toThrow('RevenueCat API network timeout');
    });
  });
});
