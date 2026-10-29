import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetTopClientMentionsService } from './GetTopClientMentions.Service';
import { Client } from 'model/users/Client.entity';
import { GetClientMentionExtraDataByClientService } from './GetClientMentionExtraDataByClient.Service';

describe('GetTopClientMentionsService', () => {
  let service: GetTopClientMentionsService;
  let clientRepository: any;
  let getClientMentionExtraDataByClientService: any;

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
    getClientMentionExtraDataByClientService = {
      call: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetTopClientMentionsService,
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: GetClientMentionExtraDataByClientService,
          useValue: getClientMentionExtraDataByClientService,
        },
      ],
    }).compile();

    service = module.get<GetTopClientMentionsService>(
      GetTopClientMentionsService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('call', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv, MENTION_SUGESTION_SIZE: '10' };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return client mentions when inputs are valid', async () => {
      // Arrange
      const mockClients = [{ id: '1' }, { id: '2' }] as any;
      clientRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce(mockClients);
      getClientMentionExtraDataByClientService.call.mockResolvedValue({
        display: 'test',
      } as any);

      // Act
      const result = await service.call('user-id', false);

      // Assert
      expect(result).toHaveLength(2);
      expect(clientRepository.createQueryBuilder().limit).toHaveBeenCalledWith(
        10,
      );
      expect(
        getClientMentionExtraDataByClientService.call,
      ).toHaveBeenCalledTimes(2);
    });

    it('should apply artist filter when artistOnly is true', async () => {
      // Arrange
      clientRepository.createQueryBuilder().getMany.mockResolvedValueOnce([]);

      // Act
      await service.call('user-id', true);

      // Assert
      expect(
        clientRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith('artist.id is not null');
    });

    it('should apply artist filter when artistOnly is string "true"', async () => {
      // Arrange
      clientRepository.createQueryBuilder().getMany.mockResolvedValueOnce([]);

      // Act
      await service.call('user-id', 'true');

      // Assert
      expect(
        clientRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith('artist.id is not null');
    });

    it('should not apply artist filter when artistOnly is false', async () => {
      // Arrange
      clientRepository.createQueryBuilder().getMany.mockResolvedValueOnce([]);

      // Act
      await service.call('user-id', false);

      // Assert
      expect(
        clientRepository.createQueryBuilder().andWhere,
      ).not.toHaveBeenCalledWith('artist.id is not null');
    });

    it('should return empty array when no clients found', async () => {
      // Arrange
      clientRepository.createQueryBuilder().getMany.mockResolvedValueOnce([]);

      // Act
      const result = await service.call('user-id', false);

      // Assert
      expect(result).toEqual([]);
    });

    it('should propagate error if extra data service fails', async () => {
      // Arrange
      clientRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([{ id: '1' }] as any);
      getClientMentionExtraDataByClientService.call.mockRejectedValueOnce(
        new Error('Service failed'),
      );

      // Act & Assert
      await expect(service.call('user-id', false)).rejects.toThrow(
        'Service failed',
      );
    });

    it('should correctly build the query', async () => {
      // Arrange
      clientRepository.createQueryBuilder().getMany.mockResolvedValueOnce([]);

      // Act
      await service.call('user-id', false);

      // Assert
      expect(
        clientRepository.createQueryBuilder().leftJoinAndSelect,
      ).toHaveBeenCalledWith('client.artist', 'artist');
      expect(clientRepository.createQueryBuilder().where).toHaveBeenCalledWith(
        'client.username is not null',
      );
      expect(
        clientRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith('client.id != :id', { id: 'user-id' });
    });
  });
});
