import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PremiumService } from './Premium.service';
import { FirebaseService } from 'modules/firebase/Firebase.service';
import { UpgradePremiumService } from './UpgradePremium.Service';
import { DowngradePremiumService } from './DowngradePremium.Service';

describe('PremiumService', () => {
  let service: PremiumService;
  let firebaseService: any;
  let upgradePremiumService: any;
  let downgradePremiumService: any;

  beforeEach(async () => {
    firebaseService = {
      changeCustomClaims: jest.fn(),
      getClaim: jest.fn(),
    };
    upgradePremiumService = {
      upgrade: jest.fn(),
    };
    downgradePremiumService = {
      downgrade: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PremiumService,
        {
          provide: FirebaseService,
          useValue: firebaseService,
        },
        {
          provide: UpgradePremiumService,
          useValue: upgradePremiumService,
        },
        {
          provide: DowngradePremiumService,
          useValue: downgradePremiumService,
        },
      ],
    }).compile();

    service = module.get<PremiumService>(PremiumService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('changePremiumStatus', () => {
    it('should upgrade premium and set addless claim when premiumStatus and addless are true', async () => {
      // Arrange
      firebaseService.changeCustomClaims.mockResolvedValueOnce(null);
      upgradePremiumService.upgrade.mockResolvedValueOnce(null);

      // Act
      await service.changePremiumStatus(
        'test-id' as any,
        true as any,
        true as any,
      );

      // Assert
      expect(upgradePremiumService.upgrade).toHaveBeenCalledWith('test-id');
      expect(downgradePremiumService.downgrade).not.toHaveBeenCalled();
      expect(firebaseService.changeCustomClaims).toHaveBeenCalledWith(
        'test-id',
        'addless',
        true,
      );
    });

    it('should downgrade premium and unset addless claim when premiumStatus is false and addless is false', async () => {
      // Arrange
      firebaseService.changeCustomClaims.mockResolvedValueOnce(null);
      downgradePremiumService.downgrade.mockResolvedValueOnce(null);

      // Act
      await service.changePremiumStatus(
        'test-id' as any,
        false as any,
        false as any,
      );

      // Assert
      expect(downgradePremiumService.downgrade).toHaveBeenCalledWith('test-id');
      expect(upgradePremiumService.upgrade).not.toHaveBeenCalled();
      expect(firebaseService.changeCustomClaims).toHaveBeenCalledWith(
        'test-id',
        'addless',
        false,
      );
    });

    it('should propagate errors from upgrade service', async () => {
      // Arrange
      const error = new Error('Upgrade failed');
      upgradePremiumService.upgrade.mockRejectedValueOnce(error);
      firebaseService.changeCustomClaims.mockResolvedValueOnce(null);

      // Act & Assert
      await expect(
        service.changePremiumStatus('test-id' as any, true as any, true as any),
      ).rejects.toThrow('Upgrade failed');
    });

    it('should propagate errors from downgrade service', async () => {
      // Arrange
      const error = new Error('Downgrade failed');
      downgradePremiumService.downgrade.mockRejectedValueOnce(error);
      firebaseService.changeCustomClaims.mockResolvedValueOnce(null);

      // Act & Assert
      await expect(
        service.changePremiumStatus(
          'test-id' as any,
          false as any,
          false as any,
        ),
      ).rejects.toThrow('Downgrade failed');
    });

    it('should propagate errors from firebase changeCustomClaims', async () => {
      // Arrange
      const error = new Error('Firebase claim error');
      upgradePremiumService.upgrade.mockResolvedValueOnce(null);
      firebaseService.changeCustomClaims.mockRejectedValueOnce(error);

      // Act & Assert
      await expect(
        service.changePremiumStatus('test-id' as any, true as any, true as any),
      ).rejects.toThrow('Firebase claim error');
    });
  });

  describe('checkPremium', () => {
    it('should return premium claim when firebaseId is valid', async () => {
      // Arrange
      firebaseService.getClaim.mockResolvedValueOnce(true as any);

      // Act
      const result = await service.checkPremium('test-id' as any);

      // Assert
      expect(firebaseService.getClaim).toHaveBeenCalledWith(
        'test-id',
        'premium',
      );
      expect(result).toBe(true);
    });

    it('should throw UnauthorizedException when firebaseId is falsy', async () => {
      // Act & Assert
      await expect(service.checkPremium('' as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should propagate errors from firebaseService.getClaim', async () => {
      // Arrange
      const error = new Error('Database unavailable');
      firebaseService.getClaim.mockRejectedValueOnce(error);

      // Act & Assert
      await expect(service.checkPremium('test-id' as any)).rejects.toThrow(
        'Database unavailable',
      );
    });
  });
});
