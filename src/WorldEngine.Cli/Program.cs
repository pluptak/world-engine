using System.Text;
using WorldEngine.Cli;

// The command line: one JSON request on standard input, one canonical answer on standard output (src/cli/main.ts).
var output = CliRunner.Run(args, Console.In.ReadToEnd());
using var stdout = Console.OpenStandardOutput();
stdout.Write(Encoding.UTF8.GetBytes(output.Stdout));
return output.Status;
