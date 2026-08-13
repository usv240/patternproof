import { BlockList, isIP } from "node:net";

const forbiddenIpv4 = new BlockList();
forbiddenIpv4.addSubnet("0.0.0.0", 8, "ipv4");
forbiddenIpv4.addSubnet("10.0.0.0", 8, "ipv4");
forbiddenIpv4.addSubnet("100.64.0.0", 10, "ipv4");
forbiddenIpv4.addSubnet("127.0.0.0", 8, "ipv4");
forbiddenIpv4.addSubnet("169.254.0.0", 16, "ipv4");
forbiddenIpv4.addSubnet("172.16.0.0", 12, "ipv4");
forbiddenIpv4.addSubnet("192.168.0.0", 16, "ipv4");
forbiddenIpv4.addSubnet("198.18.0.0", 15, "ipv4");
forbiddenIpv4.addSubnet("224.0.0.0", 4, "ipv4");

const forbiddenIpv6 = new BlockList();
forbiddenIpv6.addSubnet("::", 128, "ipv6");
forbiddenIpv6.addSubnet("::1", 128, "ipv6");
forbiddenIpv6.addSubnet("::ffff:0:0", 96, "ipv6");
forbiddenIpv6.addSubnet("fc00::", 7, "ipv6");
forbiddenIpv6.addSubnet("fe80::", 10, "ipv6");
forbiddenIpv6.addSubnet("ff00::", 8, "ipv6");

export function isPrivateNetworkAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return forbiddenIpv4.check(address, "ipv4");
  if (version === 6) return forbiddenIpv6.check(address, "ipv6");
  return false;
}