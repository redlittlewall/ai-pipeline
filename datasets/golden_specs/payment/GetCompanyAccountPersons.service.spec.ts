import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetCompanyAccountPersonsService } from './GetCompanyAccountPersons.service';
import { Artist } from 'model/users/Artist.entity';
import { StripeCreateConnectedAccountService } from './StripeCreateConnectedAccount.service';
import { StripePersonDTO } from 'model/dto/stripe/StripePersonDTO';

describe('GetCompanyAccountPersonsService', () => {
  let service: GetCompanyAccountPersonsService;
  let artistRepository: any;
  let stripeCreateConnectedAccountService: any;

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
    stripeCreateConnectedAccountService = {
      buscarPessoasDaEmpresa: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetCompanyAccountPersonsService,
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: StripeCreateConnectedAccountService,
          useValue: stripeCreateConnectedAccountService,
        },
      ],
    }).compile();

    service = module.get<GetCompanyAccountPersonsService>(
      GetCompanyAccountPersonsService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handle', () => {
    it('should return persons when artist has a stripe account', async () => {
      // Arrange
      const mockArtist = {
        id: 'artist-1',
        stripeAccount: { id: 'acct_123' },
      } as any;
      const mockPersons = [
        new StripePersonDTO('person-1', 'John', 'active', true, false),
      ] as any;

      artistRepository.findOne.mockResolvedValueOnce(mockArtist);
      stripeCreateConnectedAccountService.buscarPessoasDaEmpresa.mockResolvedValueOnce(
        mockPersons,
      );

      // Act
      const result = await service.handle('artist-1' as any);

      // Assert
      expect(artistRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'artist-1' },
        relations: ['stripeAccount'],
      });
      expect(
        stripeCreateConnectedAccountService.buscarPessoasDaEmpresa,
      ).toHaveBeenCalledWith('acct_123');
      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      expect(result).toEqual(mockPersons);
    });

    it('should return empty array when artist has no stripe account', async () => {
      // Arrange
      const mockArtist = {
        id: 'artist-2',
        stripeAccount: null,
      } as any;

      artistRepository.findOne.mockResolvedValueOnce(mockArtist);

      // Act
      const result = await service.handle('artist-2' as any);

      // Assert
      expect(artistRepository.findOne).toHaveBeenCalled();
      expect(
        stripeCreateConnectedAccountService.buscarPessoasDaEmpresa,
      ).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should return empty array when artist is not found', async () => {
      // Arrange
      artistRepository.findOne.mockResolvedValueOnce(null);

      // Act
      const result = await service.handle('non-existent-id' as any);

      // Assert
      expect(artistRepository.findOne).toHaveBeenCalled();
      expect(
        stripeCreateConnectedAccountService.buscarPessoasDaEmpresa,
      ).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should propagate repository errors', async () => {
      // Arrange
      const repoError = new Error('Database unavailable');
      artistRepository.findOne.mockRejectedValueOnce(repoError);

      // Act & Assert
      await expect(service.handle('any-id' as any)).rejects.toThrow(
        'Database unavailable',
      );
    });

    it('should propagate errors from Stripe service', async () => {
      // Arrange
      const mockArtist = {
        id: 'artist-3',
        stripeAccount: { id: 'acct_456' },
      } as any;
      const stripeError = new Error('Stripe failure');

      artistRepository.findOne.mockResolvedValueOnce(mockArtist);
      stripeCreateConnectedAccountService.buscarPessoasDaEmpresa.mockRejectedValueOnce(
        stripeError,
      );

      // Act & Assert
      await expect(service.handle('artist-3' as any)).rejects.toThrow(
        'Stripe failure',
      );
      expect(
        stripeCreateConnectedAccountService.buscarPessoasDaEmpresa,
      ).toHaveBeenCalledWith('acct_456');
    });
  });
});
