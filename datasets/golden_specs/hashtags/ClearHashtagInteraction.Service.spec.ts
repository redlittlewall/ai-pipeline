import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClearHashtagInteractionService } from './ClearHashtagInteraction.Service';
import { ClientInteractHashtag } from 'model/hashtag/ClientInteractHashtag.entity';
import { TattooDetailsHasHashtag } from 'model/hashtag/TattooHasHashtag.entity';

describe('ClearHashtagInteractionService', () => {
  let service: ClearHashtagInteractionService;
  let clientInteractHashtagRepository: any;
  let tattooDetailsHasHashtagRepository: any;

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
    clientInteractHashtagRepository = createMockRepository();
    tattooDetailsHasHashtagRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClearHashtagInteractionService,
        {
          provide: getRepositoryToken(ClientInteractHashtag),
          useValue: clientInteractHashtagRepository,
        },
        {
          provide: getRepositoryToken(TattooDetailsHasHashtag),
          useValue: tattooDetailsHasHashtagRepository,
        },
      ],
    }).compile();

    service = module.get<ClearHashtagInteractionService>(
      ClearHashtagInteractionService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('clearClientInteraction', () => {
    it('should execute clearClientInteraction successfully', async () => {
      // Given (Arrange)
      // Configure injected repository/service mocks if needed

      // When (Act)
      const result = await service.clearClientInteraction('test-id' as any);

      // Then (Assert)
      // Method returns void; verify execution completes without throwing
      expect(result).toBeUndefined();
    });
  });

  describe('clearTattooHashtags', () => {
    it('should execute clearTattooHashtags successfully', async () => {
      // Given (Arrange)
      // Configure injected repository/service mocks if needed

      // When (Act)
      const result = await service.clearTattooHashtags('test-id' as any);

      // Then (Assert)
      // Method returns void; verify execution completes without throwing
      expect(result).toBeUndefined();
    });
  });
});
