import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetBudgetOffersService } from './GetBudgetOffers.service';
import { Client } from 'model/users/Client.entity';
import { BudgetOffer } from 'model/budget/BudgetOffer.entity';
import { ClientService } from 'modules/users/Client.Service';

describe('GetBudgetOffersService', () => {
  let service: GetBudgetOffersService;
  let clientRepository: any;
  let budgetOfferRepository: any;
  let clientService: any;

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
    clientRepository = createMockRepository();
    budgetOfferRepository = createMockRepository();
    clientService = {
      getClientDto: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetBudgetOffersService,
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(BudgetOffer),
          useValue: budgetOfferRepository,
        },
        {
          provide: ClientService,
          useValue: clientService,
        },
      ],
    }).compile();

    service = module.get<GetBudgetOffersService>(GetBudgetOffersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getLastValidOffer', () => {
    it('should return null when no offers are found', async () => {
      budgetOfferRepository.find.mockResolvedValueOnce([]);
      const result = await service.getLastValidOffer('user-1', 'budget-1');
      expect(result).toBeNull();
    });

    it('should return offer DTO when offers exist (isUserMode true)', async () => {
      const mockOffer = {
        id: 'offer-1',
        budget: { id: 'budget-1', owner: { id: 'user-1' }, qrCode: 'qr-code' },
        artist: { client: { id: 'artist-client' } },
        price: { received: true },
        createdAt: new Date(),
        availability: 'any',
        status: 'pending',
        statusChangedBy: { id: 'admin-1' },
        statusComment: 'ok',
        comment: 'hello',
      } as any;

      budgetOfferRepository.find.mockResolvedValueOnce([mockOffer]);
      clientService.getClientDto.mockResolvedValue({ id: 'dto' } as any);

      const result = await service.getLastValidOffer('user-1', 'budget-1');

      expect(result).toBeDefined();
      expect(result.qrCode).toBe('qr-code');
      expect(budgetOfferRepository.find).toHaveBeenCalled();
    });

    it('should return offer DTO when offers exist (isUserMode false)', async () => {
      const mockOffer = {
        id: 'offer-1',
        budget: {
          id: 'budget-1',
          owner: { id: 'other-user' },
          qrCode: 'qr-code',
        },
        artist: { client: { id: 'artist-client' } },
        price: { received: true },
        createdAt: new Date(),
        statusChangedBy: null,
      } as any;

      budgetOfferRepository.find.mockResolvedValueOnce([mockOffer]);
      clientService.getClientDto.mockResolvedValue({ id: 'dto' } as any);

      const result = await service.getLastValidOffer('user-1', 'budget-1');

      expect(result.qrCode).toBeNull();
    });
  });

  describe('getApprovedOffer', () => {
    it('should return null when no approved offer is found', async () => {
      budgetOfferRepository.findOne.mockResolvedValueOnce(null);
      const result = await service.getApprovedOffer('user-1', 'budget-1');
      expect(result).toBeNull();
    });

    it('should return approved offer DTO successfully', async () => {
      const mockOffer = {
        id: 'offer-1',
        budget: { id: 'budget-1', owner: { id: 'user-1' }, qrCode: 'qr' },
        artist: { client: { id: 'artist' } },
        statusChangedBy: null,
      } as any;

      budgetOfferRepository.findOne.mockResolvedValueOnce(mockOffer);
      clientService.getClientDto.mockResolvedValue({ id: 'client-dto' } as any);

      const result = await service.getApprovedOffer('user-1', 'budget-1');

      expect(result).toBeDefined();
      expect(budgetOfferRepository.findOne).toHaveBeenCalled();
    });
  });

  describe('getPublicOffers', () => {
    it('should return list of offers for budget owner', async () => {
      const mockOffers = [
        { id: '1', budget: {}, artist: { client: {} } },
      ] as any;
      budgetOfferRepository.find.mockResolvedValueOnce(mockOffers);
      clientService.getClientDto.mockResolvedValue({ id: 'dto' } as any);

      const result = await service.getPublicOffers(
        true,
        'artist-1',
        'budget-1',
      );

      expect(result).toHaveLength(1);
      expect(budgetOfferRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { budget: { id: 'budget-1' }, status: expect.anything() },
        }),
      );
    });

    it('should return list of offers for specific artist', async () => {
      const mockOffers = [
        { id: '1', budget: {}, artist: { client: {} } },
      ] as any;
      budgetOfferRepository.find.mockResolvedValueOnce(mockOffers);
      clientService.getClientDto.mockResolvedValue({ id: 'dto' } as any);

      const result = await service.getPublicOffers(
        false,
        'artist-1',
        'budget-1',
      );

      expect(result).toHaveLength(1);
      expect(budgetOfferRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            budget: { id: 'budget-1' },
            artist: { id: 'artist-1' },
            status: expect.anything(),
          },
        }),
      );
    });

    it('should propagate errors when repository fails', async () => {
      budgetOfferRepository.find.mockRejectedValueOnce(new Error('DB Error'));
      await expect(service.getPublicOffers(true, 'a', 'b')).rejects.toThrow(
        'DB Error',
      );
    });
  });
});
