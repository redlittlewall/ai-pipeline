import { Test, TestingModule } from '@nestjs/testing';
import { RevenueCatCallbackService } from './RevenueCatCallback.service';
import { PremiumService } from 'modules/premium/Premium.service';
import { RevenueCatHookType } from 'enums/RevenueCatHookType';

describe('RevenueCatCallbackService', () => {
  let service: RevenueCatCallbackService;
  let premiumService: any;

  beforeEach(async () => {
    premiumService = {
      changePremiumStatus: jest.fn(),
      checkPremium: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RevenueCatCallbackService,
        {
          provide: PremiumService,
          useValue: premiumService,
        },
      ],
    }).compile();

    service = module.get<RevenueCatCallbackService>(RevenueCatCallbackService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('call', () => {
    const clientId = 'client-123';

    it('should upgrade to premium on INITIAL_PURCHASE if client is not premium', async () => {
      // Arrange
      premiumService.checkPremium.mockResolvedValueOnce(false);
      premiumService.changePremiumStatus.mockResolvedValueOnce({} as any);

      // Act
      await service.call(clientId, RevenueCatHookType.INITIAL_PURCHASE);

      // Assert
      expect(premiumService.checkPremium).toHaveBeenCalledWith(clientId);
      expect(premiumService.changePremiumStatus).toHaveBeenCalledWith(
        clientId,
        true,
      );
    });

    it('should not upgrade to premium on RENEWAL if client is already premium', async () => {
      // Arrange
      premiumService.checkPremium.mockResolvedValueOnce(true);

      // Act
      await service.call(clientId, RevenueCatHookType.RENEWAL);

      // Assert
      expect(premiumService.checkPremium).toHaveBeenCalledWith(clientId);
      expect(premiumService.changePremiumStatus).not.toHaveBeenCalled();
    });

    it('should upgrade to premium on UNCANCELLATION if client is not premium', async () => {
      // Arrange
      premiumService.checkPremium.mockResolvedValueOnce(false);
      premiumService.changePremiumStatus.mockResolvedValueOnce({} as any);

      // Act
      await service.call(clientId, RevenueCatHookType.UNCANCELLATION);

      // Assert
      expect(premiumService.changePremiumStatus).toHaveBeenCalledWith(
        clientId,
        true,
      );
    });

    it('should downgrade from premium on CANCELLATION if client is premium', async () => {
      // Arrange
      premiumService.checkPremium.mockResolvedValueOnce(true);
      premiumService.changePremiumStatus.mockResolvedValueOnce({} as any);

      // Act
      await service.call(clientId, RevenueCatHookType.CANCELLATION);

      // Assert
      expect(premiumService.checkPremium).toHaveBeenCalledWith(clientId);
      expect(premiumService.changePremiumStatus).toHaveBeenCalledWith(
        clientId,
        false,
      );
    });

    it('should not downgrade from premium on EXPIRATION if client is already not premium', async () => {
      // Arrange
      premiumService.checkPremium.mockResolvedValueOnce(false);

      // Act
      await service.call(clientId, RevenueCatHookType.EXPIRATION);

      // Assert
      expect(premiumService.changePremiumStatus).not.toHaveBeenCalled();
    });

    it('should downgrade from premium on SUBSCRIPTION_PAUSED if client is premium', async () => {
      // Arrange
      premiumService.checkPremium.mockResolvedValueOnce(true);
      premiumService.changePremiumStatus.mockResolvedValueOnce({} as any);

      // Act
      await service.call(clientId, RevenueCatHookType.SUBSCRIPTION_PAUSED);

      // Assert
      expect(premiumService.changePremiumStatus).toHaveBeenCalledWith(
        clientId,
        false,
      );
    });

    it('should log and take no action for TRANSFER event', async () => {
      // Arrange
      premiumService.checkPremium.mockResolvedValueOnce(true);

      // Act
      await service.call(clientId, RevenueCatHookType.TRANSFER);

      // Assert
      expect(premiumService.changePremiumStatus).not.toHaveBeenCalled();
    });

    it('should log and take no action for NON_RENEWING_PURCHASE event', async () => {
      // Arrange
      premiumService.checkPremium.mockResolvedValueOnce(false);

      // Act
      await service.call(clientId, RevenueCatHookType.NON_RENEWING_PURCHASE);

      // Assert
      expect(premiumService.changePremiumStatus).not.toHaveBeenCalled();
    });

    it('should log and take no action for BILLING_ISSUE event', async () => {
      // Arrange
      premiumService.checkPremium.mockResolvedValueOnce(true);

      // Act
      await service.call(clientId, RevenueCatHookType.BILLING_ISSUE);

      // Assert
      expect(premiumService.changePremiumStatus).not.toHaveBeenCalled();
    });

    it('should log when event type is NOT MAPPED', async () => {
      // Arrange
      premiumService.checkPremium.mockResolvedValueOnce(true);

      // Act
      await service.call(clientId, 'UNKNOWN_EVENT' as any);

      // Assert
      expect(premiumService.changePremiumStatus).not.toHaveBeenCalled();
    });

    it('should catch and log errors if premiumService fails', async () => {
      // Arrange
      const error = new Error('Service Failure');
      premiumService.checkPremium.mockRejectedValueOnce(error);

      // Act & Assert
      // The service catches internally, so it should not throw
      await expect(
        service.call(clientId, RevenueCatHookType.INITIAL_PURCHASE),
      ).resolves.toBeUndefined();
    });
  });
});
