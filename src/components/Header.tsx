import { Box, Text } from "ink";

export function Header() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">
        {"  S U P E R D E E P"}
      </Text>
      <Text dimColor>{"  Deep Research CLI v0.1.0"}</Text>
    </Box>
  );
}
