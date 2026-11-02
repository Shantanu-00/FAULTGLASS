from __future__ import annotations

from pymodbus.constants import ExcCodes
from pymodbus.server import ModbusTcpServer
from pymodbus.simulator import DataType, SimData, SimDevice

from ..plant.registers import RegisterPlan

FC_DISCRETE = 2
FC_HOLDING = 3
FC_INPUT = 4


class PlcServer:
    def __init__(self, plan: RegisterPlan, host: str, port: int):
        self._plan = plan
        self._host = host
        self._port = port
        self._words: dict[str, list[int]] = {
            table: [0] * plan.size(table) for table in ("discrete", "input", "holding")
        }
        self._server: ModbusTcpServer | None = None

    def publish(self, values: dict[str, float]) -> None:
        words = {table: [0] * len(block) for table, block in self._words.items()}
        for point in self._plan.points:
            if point.table in words and point.tag in values:
                words[point.table][point.offset] = point.encode(values[point.tag])
        self._words = words

    async def start(self) -> None:
        self._server = ModbusTcpServer(self._device(), address=(self._host, self._port))
        await self._server.serve_forever(background=True)

    async def stop(self) -> None:
        if self._server is not None:
            await self._server.shutdown()
            self._server = None

    def _device(self) -> SimDevice:
        discrete = max(self._plan.size("discrete"), 1)
        input_regs = max(self._plan.size("input"), 1)
        holding = max(self._plan.size("holding"), 1)
        return SimDevice(
            id=self._plan.unit_id,
            simdata=(
                [SimData(0, count=1, values=False, datatype=DataType.BITS)],
                [SimData(0, count=discrete, values=False, datatype=DataType.BITS)],
                [SimData(0, count=holding, values=0, datatype=DataType.REGISTERS)],
                [SimData(0, count=input_regs, values=0, datatype=DataType.REGISTERS)],
            ),
            action=self._on_access,
        )

    async def _on_access(self, function_code, start_address, address, count, registers, set_values):
        if set_values is not None:
            return ExcCodes.ILLEGAL_FUNCTION
        if function_code == FC_DISCRETE:
            bits = self._words["discrete"]
            for word in range(count):
                packed = 0
                for bit in range(16):
                    index = (address + word) * 16 + bit
                    if index < len(bits) and bits[index]:
                        packed |= 1 << bit
                registers[address - start_address + word] = packed
        elif function_code in (FC_HOLDING, FC_INPUT):
            block = self._words["holding" if function_code == FC_HOLDING else "input"]
            for i in range(count):
                if address + i < len(block):
                    registers[address - start_address + i] = block[address + i]
        return None
