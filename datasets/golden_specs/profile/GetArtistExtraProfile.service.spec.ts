import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetArtistExtraProfileService } from './GetArtistExtraProfile.service';
import { Artist } from 'model/users/Artist.entity';
import { ClientInteractArtist } from 'model/users/relations/ClientInteractArtist.entity';
import { ReviewBudget } from 'model/budget/ReviewBudget.entity';
import { GetArtistAddressService } from 'modules/address/artist/GetArtistAddress.service';
import { GetAverageStarsService } from './GetAverageStars.Service';
import { ClientInteractionWorkflow } from 'modules/interaction/ClientInteractionWorkflow';

describe('GetArtistExtraProfileService', () => {
  let service: GetArtistExtraProfileService;
  let artistRepository: any;
  let clientInteractArtistRepository: any;
  let reviewBudgetRepository: any;
  let getArtistAddressService: any;
  let getAverageStarsService: any;
  let clientInteractionWorkflow: any;

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
    clientInteractArtistRepository = createMockRepository();
    reviewBudgetRepository = createMockRepository();
    getArtistAddressService = {
      get: jest.fn(),
    };
    getAverageStarsService = {
      call: jest.fn(),
    };
    clientInteractionWorkflow = {
      interact: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetArtistExtraProfileService,
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractArtist),
          useValue: clientInteractArtistRepository,
        },
        {
          provide: getRepositoryToken(ReviewBudget),
          useValue: reviewBudgetRepository,
        },
        {
          provide: GetArtistAddressService,
          useValue: getArtistAddressService,
        },
        {
          provide: GetAverageStarsService,
          useValue: getAverageStarsService,
        },
        {
          provide: ClientInteractionWorkflow,
          useValue: clientInteractionWorkflow,
        },
      ],
    }).compile();

    service = module.get<GetArtistExtraProfileService>(
      GetArtistExtraProfileService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('call', () => {
    it('should execute call successfully', async () => {
      // Given (Arrange)
      // Configure injected repository/service mocks if needed

      // When (Act)
      const result = await service.call('test-id' as any, 'test-id' as any);

      // Then (Assert)
      expect(result).toBeDefined();
    });
  });
});
