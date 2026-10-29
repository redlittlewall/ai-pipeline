import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeleteAnonymousUsersService } from './DeleteAnonymousUsers.service';
import { Client } from 'model/users/Client.entity';
import { DeleteUserService } from 'modules/users/DeleteUserService';

describe('DeleteAnonymousUsersService', () => {
  let service: DeleteAnonymousUsersService;
  let clientRepository: any;
  let deleteUserService: any;

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
    deleteUserService = {
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeleteAnonymousUsersService,
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: DeleteUserService,
          useValue: deleteUserService,
        },
      ],
    }).compile();

    service = module.get<DeleteAnonymousUsersService>(
      DeleteAnonymousUsersService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('delete', () => {
    it('should delete users found by repository', async () => {
      // Arrange
      const mockUsers = [{ id: '1' }, { id: '2' }] as any;
      clientRepository.find.mockResolvedValue(mockUsers);

      // Act
      await service.delete();

      // Assert
      expect(clientRepository.find).toHaveBeenCalled();
      expect(deleteUserService.delete).toHaveBeenCalledTimes(2);
      expect(deleteUserService.delete).toHaveBeenCalledWith('1');
      expect(deleteUserService.delete).toHaveBeenCalledWith('2');
    });

    it('should not delete anything if no users are found', async () => {
      // Arrange
      clientRepository.find.mockResolvedValue([]);

      // Act
      await service.delete();

      // Assert
      expect(clientRepository.find).toHaveBeenCalled();
      expect(deleteUserService.delete).not.toHaveBeenCalled();
    });
  });
});
