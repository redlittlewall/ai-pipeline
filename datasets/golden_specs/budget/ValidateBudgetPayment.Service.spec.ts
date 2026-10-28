import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { ValidateBudgetPaymentService } from './ValidateBudgetPayment.Service';
import { Artist } from 'model/users/Artist.entity';
import { Budget } from 'model/budget/Budget.entity';
import { Client } from 'model/users/Client.entity';
import { ArtistPayoutRequest } from 'model/payment/ArtistPayoutRequest.entity';
import { PriceEntity } from 'model/payment/Price.entity';
import { QrCodeService } from 'modules/payment/QrCode.Service';
import { StripeCreateConnectedAccountService } from 'modules/payment/stripe/StripeCreateConnectedAccount.service';
import { CreateStripeTransferService } from '../CreateStripeTransferService';
import { BudgetChatSocketService } from '../chat/BudgetChatSocket.Service';
import { BudgetStatus } from 'enums/BudgetStatus';

describe('ValidateBudgetPaymentService', () => {
  let service: ValidateBudgetPaymentService;
  let artistRepository: any;
  let budgetRepository: any;
  let clientRepository: any;
  let moneyTransactionRepository: any;
  let priceEntityRepository: any;
  let qrCodeService: any;
  let stripeCreateConnectedAccountService: any;
  let createStripeTransferService: any;
  let budgetChatSocketService: any;

  beforeEach(async () => {
    const createQueryBuilderMock = () => {
      const qb: any = new Proxy(
        {},
        {
          get(target, prop) {
            if (prop === 'then') return undefined;
            if (!(prop in target)) {
              target[prop] = jest.fn().mockImplementation((...args: any[]) => {
                if (args.length > 0 && typeof args[0] === 'function') {
                  args[0](qb);
                } else if (
                  args.length > 0 &&
                  args[0] &&
                  typeof args[0].whereFactory === 'function'
                ) {
                  args[0].whereFactory(qb);
                }
                return qb;
              });
            }
            return target[prop];
          },
        },
      );
      qb.getOne = jest.fn().mockResolvedValue(null);
      qb.getMany = jest.fn().mockResolvedValue([]);
      qb.getRawOne = jest.fn().mockResolvedValue(null);
      qb.getRawMany = jest.fn().mockResolvedValue([]);
      qb.getCount = jest.fn().mockResolvedValue(0);
      qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      qb.execute = jest.fn().mockResolvedValue({ affected: 1, raw: [] });
      return qb;
    };

    const createMockRepository = () => {
      const qb = createQueryBuilderMock();
      return {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([]),
        findAndCount: jest.fn().mockResolvedValue([[], 0]),
        save: jest
          .fn()
          .mockImplementation((e: any) =>
            Promise.resolve({ id: 'mock-id', ...(e || {}) }),
          ),
        create: jest.fn().mockImplementation((e: any) => e),
        update: jest
          .fn()
          .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
        delete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        softDelete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        restore: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        count: jest.fn().mockResolvedValue(0),
        exist: jest.fn().mockResolvedValue(false),
        remove: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
    };
    artistRepository = createMockRepository();
    budgetRepository = createMockRepository();
    clientRepository = createMockRepository();
    moneyTransactionRepository = createMockRepository();
    priceEntityRepository = createMockRepository();
    qrCodeService = {
      validate: jest.fn(),
    };
    stripeCreateConnectedAccountService = {};
    createStripeTransferService = {
      handle: jest.fn(),
    };
    budgetChatSocketService = {
      updateBudget: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateBudgetPaymentService,
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(ArtistPayoutRequest),
          useValue: moneyTransactionRepository,
        },
        {
          provide: getRepositoryToken(PriceEntity),
          useValue: priceEntityRepository,
        },
        {
          provide: QrCodeService,
          useValue: qrCodeService,
        },
        {
          provide: StripeCreateConnectedAccountService,
          useValue: stripeCreateConnectedAccountService,
        },
        {
          provide: CreateStripeTransferService,
          useValue: createStripeTransferService,
        },
        {
          provide: BudgetChatSocketService,
          useValue: budgetChatSocketService,
        },
      ],
    }).compile();

    service = module.get<ValidateBudgetPaymentService>(
      ValidateBudgetPaymentService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('call', () => {
    it('should execute call successfully and return true when inputs are valid', async () => {
      // Given (Arrange)
      const artistId = 'artist-123';
      const budgetId = 'budget-456';
      const qrCode = 'qr-789';

      const mockArtist = {
        id: artistId,
        stripeAccount: { id: 'stripe-acc-123' },
      } as any;

      const mockBudget = {
        id: budgetId,
        price: { artistValue: 100 },
        owner: { id: 'client-123' },
      } as any;

      qrCodeService.validate.mockResolvedValueOnce(true);
      artistRepository.findOne.mockResolvedValueOnce(mockArtist);
      budgetRepository.findOne.mockResolvedValueOnce(mockBudget);
      createStripeTransferService.handle.mockResolvedValueOnce(undefined);
      budgetRepository.update.mockResolvedValueOnce({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      budgetChatSocketService.updateBudget.mockResolvedValueOnce(undefined);

      // When (Act)
      const result = await service.call(artistId, budgetId, qrCode);

      // Then (Assert)
      expect(qrCodeService.validate).toHaveBeenCalledWith(
        artistId,
        budgetId,
        qrCode,
      );
      expect(artistRepository.findOne).toHaveBeenCalledWith({
        where: { id: artistId },
        relations: ['stripeAccount'],
      });
      expect(budgetRepository.findOne).toHaveBeenCalledWith({
        where: { id: budgetId },
        relations: ['price', 'owner'],
      });
      expect(createStripeTransferService.handle).toHaveBeenCalledWith(
        100,
        'stripe-acc-123',
        mockBudget,
        artistId,
      );
      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: budgetId },
        { status: BudgetStatus.REVIEW, finalValidationAt: expect.any(Date) },
      );
      expect(budgetChatSocketService.updateBudget).toHaveBeenCalledWith(
        artistId,
        'client-123',
        budgetId,
      );
      expect(result).toBe(true);
    });

    it('should throw UnauthorizedException when QR Code is invalid', async () => {
      // Given (Arrange)
      qrCodeService.validate.mockResolvedValueOnce(false);

      // When & Then (Act & Assert)
      await expect(
        service.call('artist-123', 'budget-456', 'invalid-qr'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when artist has no stripe account', async () => {
      // Given (Arrange)
      const artistId = 'artist-123';
      const budgetId = 'budget-456';
      const qrCode = 'qr-789';

      qrCodeService.validate.mockResolvedValueOnce(true);
      artistRepository.findOne.mockResolvedValueOnce({
        id: artistId,
        stripeAccount: null,
      } as any);

      // When & Then (Act & Assert)
      await expect(service.call(artistId, budgetId, qrCode)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should propagate errors when a dependency rejects', async () => {
      // Given (Arrange)
      qrCodeService.validate.mockRejectedValueOnce(
        new Error('QR Service Error'),
      );

      // When & Then (Act & Assert)
      await expect(
        service.call('artist-123', 'budget-456', 'qr-789'),
      ).rejects.toThrow('QR Service Error');
    });
  });
});
