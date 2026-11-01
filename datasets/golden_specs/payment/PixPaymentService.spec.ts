import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PixPaymentService } from './PixPaymentService';
import { BudgetOffer } from 'model/budget/BudgetOffer.entity';
import { StripeService } from './StripeService';
import { NotFoundException } from '@nestjs/common';

describe('PixPaymentService', () => {
  let service: PixPaymentService;
  let budgetOfferRepository: any;
  let stripeService: any;

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
    budgetOfferRepository = createMockRepository();
    stripeService = {
      confirmPixPaymentIntent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PixPaymentService,
        {
          provide: getRepositoryToken(BudgetOffer),
          useValue: budgetOfferRepository,
        },
        {
          provide: StripeService,
          useValue: stripeService,
        },
      ],
    }).compile();

    service = module.get<PixPaymentService>(PixPaymentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generatePixData', () => {
    it('should return pix data when inputs are valid (Happy Path)', async () => {
      // Arrange
      const mockBudgetOffer = {
        budget: {
          price: { stripePaymentIntentId: 'pi_123' },
        },
      } as any;
      budgetOfferRepository.findOne.mockResolvedValue(mockBudgetOffer);

      const mockPaymentIntent = {
        id: 'pi_123',
        status: 'requires_action',
        amount: 1000,
        currency: 'brl',
        next_action: {
          type: 'pix_display_qr_code',
          pix_display_qr_code: {
            qr_code: 'pix_code_string',
            image_url_png: 'url_png',
            expires_at: 123456789,
          },
        },
      } as any;
      stripeService.confirmPixPaymentIntent.mockResolvedValue(
        mockPaymentIntent,
      );

      // Act
      const result = await service.generatePixData('offer_id');

      // Assert
      expect(result.paymentIntentId).toBe('pi_123');
      expect(result.pixData.qr_code).toBe('url_png');
      expect(stripeService.confirmPixPaymentIntent).toHaveBeenCalledWith(
        'pi_123',
      );
    });

    it('should throw NotFoundException when stripePaymentIntentId is missing', async () => {
      // Arrange
      const mockBudgetOffer = {
        budget: {
          price: {}, // Missing stripePaymentIntentId
        },
      } as any;
      budgetOfferRepository.findOne.mockResolvedValue(mockBudgetOffer);

      // Act & Assert
      await expect(service.generatePixData('offer_id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw Error when pix data extraction fails', async () => {
      // Arrange
      const mockBudgetOffer = {
        budget: {
          price: { stripePaymentIntentId: 'pi_123' },
        },
      } as any;
      budgetOfferRepository.findOne.mockResolvedValue(mockBudgetOffer);

      // Payment intent without pix data
      stripeService.confirmPixPaymentIntent.mockResolvedValue({ id: 'pi_123' });

      // Act & Assert
      await expect(service.generatePixData('offer_id')).rejects.toThrow(
        'Erro ao extrair dados PIX',
      );
    });

    it('should propagate errors when stripe service fails', async () => {
      // Arrange
      const mockBudgetOffer = {
        budget: {
          price: { stripePaymentIntentId: 'pi_123' },
        },
      } as any;
      budgetOfferRepository.findOne.mockResolvedValue(mockBudgetOffer);
      stripeService.confirmPixPaymentIntent.mockRejectedValue(
        new Error('Stripe API Error'),
      );

      // Act & Assert
      await expect(service.generatePixData('offer_id')).rejects.toThrow(
        'Stripe API Error',
      );
    });
  });
});
