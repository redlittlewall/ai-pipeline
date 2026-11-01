import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ViewAddressService } from './ViewAddressService';
import { Address } from 'model/address/Address.entity';
import { Client } from 'model/users/Client.entity';
import { UserNotFoundException } from 'exceptions/UserNotFoundException';
import { IsNull } from 'typeorm';

describe('ViewAddressService', () => {
  let service: ViewAddressService;
  let addressRepository: any;
  let clientRepository: any;

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
    addressRepository = createMockRepository();
    clientRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ViewAddressService,
        {
          provide: getRepositoryToken(Address),
          useValue: addressRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
      ],
    }).compile();

    service = module.get<ViewAddressService>(ViewAddressService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('changeViewLocation', () => {
    it('should throw UserNotFoundException if client is not found', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockResolvedValueOnce(null);

      // When & Then (Act & Assert)
      await expect(
        service.changeViewLocation(
          'client-1',
          'country-1',
          'state-1',
          'city-1',
        ),
      ).rejects.toThrow(UserNotFoundException);
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'client-1' },
      });
      expect(addressRepository.findOne).not.toHaveBeenCalled();
    });

    it('should link existing address to client if address already exists in db', async () => {
      // Given (Arrange)
      const mockClient = { id: 'client-1', address: null } as any;
      const existingAddress = {
        id: 'address-1',
        country: { id: 'country-1' },
        state: { id: 'state-1' },
        city: { id: 'city-1' },
      } as any;

      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      addressRepository.findOne.mockResolvedValueOnce(existingAddress);

      // When (Act)
      const result = await service.changeViewLocation(
        'client-1',
        'country-1',
        'state-1',
        'city-1',
      );

      // Then (Assert)
      expect(result).toBeUndefined();
      expect(addressRepository.save).not.toHaveBeenCalled();
      expect(mockClient.address).toBe(existingAddress);
      expect(clientRepository.save).toHaveBeenCalledWith(mockClient);
    });

    it('should create and save new address when address does not exist in db', async () => {
      // Given (Arrange)
      const mockClient = { id: 'client-1', address: null } as any;
      const createdAddress = {
        id: 'new-address-id',
        country: { id: 'country-1' },
        state: { id: 'state-1' },
        city: { id: 'city-1' },
      } as any;

      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      addressRepository.findOne.mockResolvedValueOnce(null);
      addressRepository.save.mockResolvedValueOnce(createdAddress);

      // When (Act)
      const result = await service.changeViewLocation(
        'client-1',
        'country-1',
        'state-1',
        'city-1',
      );

      // Then (Assert)
      expect(result).toBeUndefined();
      expect(addressRepository.save).toHaveBeenCalled();
      expect(mockClient.address).toBe(createdAddress);
      expect(clientRepository.save).toHaveBeenCalledWith(mockClient);
    });

    it('should query address with IsNull() when location ids are null', async () => {
      // Given (Arrange)
      const mockClient = { id: 'client-1', address: null } as any;
      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      addressRepository.findOne.mockResolvedValueOnce(null);

      // When (Act)
      await service.changeViewLocation(
        'client-1',
        null as any,
        null as any,
        null as any,
      );

      // Then (Assert)
      expect(addressRepository.findOne).toHaveBeenCalledWith({
        where: {
          city: { id: IsNull() },
          country: { id: IsNull() },
          state: { id: IsNull() },
        },
      });
      expect(clientRepository.save).toHaveBeenCalled();
    });

    it('should propagate errors when repository fails', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockRejectedValueOnce(
        new Error('Database error'),
      );

      // When & Then (Act & Assert)
      await expect(
        service.changeViewLocation(
          'client-1',
          'country-1',
          'state-1',
          'city-1',
        ),
      ).rejects.toThrow('Database error');
    });
  });

  describe('checkIfClientHasViewLocation', () => {
    it('should return true when client has an address with an id', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockResolvedValueOnce({
        id: 'client-1',
        address: { id: 'address-1' },
      } as any);

      // When (Act)
      const result = await service.checkIfClientHasViewLocation('client-1');

      // Then (Assert)
      expect(result).toBe(true);
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        loadRelationIds: {
          relations: ['address'],
          disableMixedMap: true,
        },
      });
    });

    it('should return false when client address has no id', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockResolvedValueOnce({
        id: 'client-1',
        address: {},
      } as any);

      // When (Act)
      const result = await service.checkIfClientHasViewLocation('client-1');

      // Then (Assert)
      expect(result).toBe(false);
    });

    it('should return false when client address is null or undefined', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockResolvedValueOnce({
        id: 'client-1',
        address: null,
      } as any);

      // When (Act)
      const result = await service.checkIfClientHasViewLocation('client-1');

      // Then (Assert)
      expect(result).toBe(false);
    });

    it('should propagate errors when repository rejects', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockRejectedValueOnce(
        new Error('Connection failure'),
      );

      // When & Then (Act & Assert)
      await expect(
        service.checkIfClientHasViewLocation('client-1'),
      ).rejects.toThrow('Connection failure');
    });
  });

  describe('getClientAddress', () => {
    it('should return null when client is not found', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockResolvedValueOnce(null);

      // When (Act)
      const result = await service.getClientAddress('client-1');

      // Then (Assert)
      expect(result).toBeNull();
      expect(addressRepository.findOne).not.toHaveBeenCalled();
    });

    it('should return null when client has no address relation', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockResolvedValueOnce({
        id: 'client-1',
        address: null,
      } as any);

      // When (Act)
      const result = await service.getClientAddress('client-1');

      // Then (Assert)
      expect(result).toBeNull();
      expect(addressRepository.findOne).not.toHaveBeenCalled();
    });

    it('should return null when client address has no id', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockResolvedValueOnce({
        id: 'client-1',
        address: { id: null },
      } as any);

      // When (Act)
      const result = await service.getClientAddress('client-1');

      // Then (Assert)
      expect(result).toBeNull();
      expect(addressRepository.findOne).not.toHaveBeenCalled();
    });

    it('should return address entity when client has address with id', async () => {
      // Given (Arrange)
      const mockAddress = {
        id: 'address-1',
        city: { id: 'city-1' },
        state: { id: 'state-1' },
        country: { id: 'country-1' },
      } as any;

      clientRepository.findOne.mockResolvedValueOnce({
        id: 'client-1',
        address: { id: 'address-1' },
      } as any);

      addressRepository.findOne.mockResolvedValueOnce(mockAddress);

      // When (Act)
      const result = await service.getClientAddress('client-1');

      // Then (Assert)
      expect(result).toEqual(mockAddress);
      expect(addressRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'address-1' },
        loadRelationIds: {
          relations: ['city', 'state', 'country'],
          disableMixedMap: true,
        },
      });
    });

    it('should propagate errors when address repository rejects', async () => {
      // Given (Arrange)
      clientRepository.findOne.mockResolvedValueOnce({
        id: 'client-1',
        address: { id: 'address-1' },
      } as any);
      addressRepository.findOne.mockRejectedValueOnce(
        new Error('Address find failed'),
      );

      // When & Then (Act & Assert)
      await expect(service.getClientAddress('client-1')).rejects.toThrow(
        'Address find failed',
      );
    });
  });
});
